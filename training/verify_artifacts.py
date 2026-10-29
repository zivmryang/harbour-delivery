#!/usr/bin/env python3
"""Verify published experiment consistency without downloading or running a model.

Uses only the standard library. Hashes detect mismatches, not provenance fraud;
the actual training log and prediction records remain available for inspection.
"""
import hashlib
import json
import math
import re
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KEYS = ('source_id', 'owner', 'due', 'status', 'risk')
checks = []


def require(condition, message):
    if not condition:
        raise ValueError(message)
    checks.append(message)


def read_json(path):
    return json.loads((ROOT / path).read_text(encoding='utf-8'))


def digest(path):
    return hashlib.sha256((ROOT / path).read_bytes()).hexdigest()


def parsed_json(raw):
    try:
        return json.loads(raw.strip())
    except (ValueError, TypeError):
        return None


def schema_valid(value):
    if not isinstance(value, dict) or set(value) != set(KEYS):
        return False
    if not isinstance(value['source_id'], str) or not value['source_id']:
        return False
    if value['owner'] is not None and not isinstance(value['owner'], str):
        return False
    if value['due'] is not None:
        try:
            if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value['due']):
                return False
            datetime.strptime(value['due'], '%Y-%m-%d')
        except (ValueError, TypeError):
            return False
    return value['status'] in ('todo', 'active', 'blocked', 'review', 'done', 'unknown') and value['risk'] in ('low', 'medium', 'high', 'unknown')


def verify_predictions(document, expected_rows, holdout_hash):
    require(document['datasetSha256'] == holdout_hash, 'Prediction input hash matches the held-out dataset')
    require(document['seed'] == 20261029 and document['temperature'] == 0 and document['maxTokens'] == 160,
            'Prediction settings match the fixed evaluation protocol')
    expected_by_id = {row['id']: row for row in expected_rows}
    predictions = document['predictions']
    require(len(predictions) == len(expected_by_id) == document['samples'], 'Prediction count matches all held-out examples')
    require(len({row['id'] for row in predictions}) == len(predictions) and {row['id'] for row in predictions} == set(expected_by_id),
            'Each held-out example appears exactly once in predictions')
    scored = []
    for row in predictions:
        expected = expected_by_id[row['id']]
        require(row['input'] == expected['note'] and row['expected'] == expected['expected'] and row['family'] == expected['family'],
                f'{row["id"]}: evaluated input and expected fields match the held-out record')
        raw = row['raw']
        strict = parsed_json(raw)
        normalized = parsed_json(re.sub(r'^```(?:json)?\s*([\s\S]*?)\s*```$', r'\1', raw.strip()))
        correct = {key: isinstance(normalized, dict) and key in normalized and normalized[key] == expected['expected'][key] for key in KEYS}
        score = dict(jsonValid=schema_valid(strict), normalizedJsonValid=schema_valid(normalized), correct=correct)
        require(row['parsed'] == normalized and all(row[key] == score[key] for key in score),
                f'{row["id"]}: recorded scoring matches unchanged raw model output')
        scored.append(score)
    n = len(scored)
    metrics = {
        'jsonValidRate': sum(row['jsonValid'] for row in scored) / n,
        'normalizedJsonValidRate': sum(row['normalizedJsonValid'] for row in scored) / n,
        'sourceGroundingRate': sum(row['correct']['source_id'] for row in scored) / n,
        'fieldAccuracy': sum(sum(row['correct'].values()) for row in scored) / (n * len(KEYS)),
        'exactMatchRate': sum(all(row['correct'].values()) for row in scored) / n,
        'strictExactMatchRate': sum(row['jsonValid'] and all(row['correct'].values()) for row in scored) / n,
    }
    require(document['metrics'].keys() == metrics.keys() and all(math.isclose(document['metrics'][key], value, abs_tol=1e-12) for key, value in metrics.items()),
            'Aggregate metrics recompute from all saved raw predictions')
    return metrics


def main():
    report = read_json('public/model-evaluation.json')
    require(report['status'] == 'completed', 'Public report marks the recorded experiment as completed')
    hashes = {
        'adapter': 'training/adapters/adapters.safetensors',
        'config': 'training/config.yaml',
        'holdout': 'training/data/test.jsonl',
        'baselinePredictions': 'training/results/baseline.json',
        'finetunedPredictions': 'training/results/adapted.json',
    }
    require(set(report['sha256']) == set(hashes), 'Public hash manifest has exactly the expected artefacts')
    for key, path in hashes.items():
        require(digest(path) == report['sha256'][key], f'SHA-256 matches: {path}')

    manifest = read_json('training/data/manifest.json')
    split_rows = {}
    for split in ('train', 'valid', 'test'):
        name = f'{split}.jsonl'
        rows = read_json(f'training/data/{split}.records.json')
        lines = [json.loads(line) for line in (ROOT / 'training/data' / name).read_text().splitlines() if line.strip()]
        require(len(rows) == len(lines) == manifest['counts'][split], f'{split}: dataset and metadata counts match')
        require(all(row['provenance'] == 'synthetic' and line == {'messages': row['messages']} for row, line in zip(rows, lines)),
                f'{split}: JSONL matches synthetic record metadata')
        require(all(row['messages'][1]['content'] == row['note'] and json.loads(row['messages'][2]['content']) == row['expected'] for row in rows),
                f'{split}: note and expected fields match training/evaluation messages')
        require(digest(f'training/data/{name}') == manifest['sha256'][name] == report['dataset']['sha256'][name],
                f'{split}: dataset hashes agree across both manifests')
        split_rows[split] = rows
    all_rows = [row for rows in split_rows.values() for row in rows]
    require(len({row['id'] for row in all_rows}) == len(all_rows) and len({row['note'] for row in all_rows}) == len(all_rows),
            'Source IDs and full notes are unique across all splits')
    families = {name: {row['family'] for row in rows} for name, rows in split_rows.items()}
    require(not (families['train'] & families['valid'] or families['train'] & families['test'] or families['valid'] & families['test']),
            'Template family groups are disjoint across all splits')
    require(report['dataset']['counts'] == manifest['counts'] and report['dataset']['holdoutSamples'] == len(split_rows['test']),
            'Public dataset counts match the actual files')

    for result_name, report_name in [('baseline', 'baseline'), ('adapted', 'finetuned')]:
        document = read_json(f'training/results/{result_name}.json')
        require(document['model'] == report['model'] and document['modelRevision'] == report['modelRevision'],
                f'{result_name}: base-model identity and revision match the public report')
        metrics = verify_predictions(document, split_rows['test'], report['sha256']['holdout'])
        require(metrics == report[report_name], f'{result_name}: public metrics match recomputed results')

    adapted = read_json('training/results/adapted.json')
    failures = [{'id': row['id'], 'input': row['input'], 'expected': row['expected'], 'prediction': row['parsed'],
                 'wrongFields': [key for key, value in row['correct'].items() if not value]}
                for row in adapted['predictions'] if not all(row['correct'].values())]
    require(failures == report['failures'], 'Public failure list includes every erroneous held-out record')
    require((ROOT / hashes['adapter']).stat().st_size == report['training']['adapterBytes'], 'Public adapter size matches the file')
    config = read_json('training/adapters/adapter_config.json')
    require(config['iters'] == report['training']['steps'] and config['batch_size'] == report['training']['batchSize']
            and config['num_layers'] == report['training']['layers'] and config['lora_parameters']['rank'] == report['training']['rank']
            and config['learning_rate'] == report['training']['learningRate'] and config['seed'] == report['training']['seed'],
            'Saved adapter hyperparameters match the public report')
    require((ROOT / 'training/results/training.txt').stat().st_size > 0, 'Actual training log is present')
    for name in ('server-smoke', 'gateway-smoke'):
        smoke = read_json(f'training/results/{name}.json')
        actual = smoke.get('parsed') if name == 'server-smoke' else smoke['response']['extraction']
        require(smoke['passed'] is True and actual == smoke['expected'] and smoke['synthetic'] is True,
                f'{name}: recorded live HTTP output matches its expected synthetic result')

    print(f'PASS: {len(checks)} artefact consistency checks.')
    print('Verified adapter/config/dataset/prediction SHA-256, split integrity, raw-output scoring, public metrics, failure disclosure and recorded smoke results.')
    print('This validates repository consistency; it does not independently certify training provenance or real-world effectiveness.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError, ZeroDivisionError) as error:
        print(f'FAIL: {error}', file=sys.stderr)
        raise SystemExit(1)
