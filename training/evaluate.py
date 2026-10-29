"""Greedy, identical held-out evaluation. Invalid output counts as wrong; no repairs."""
import argparse
import hashlib
import json
import platform
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import mlx.core as mx
from mlx_lm import generate, load
from mlx_lm.sample_utils import make_sampler
from model_path import MODEL, REVISION, model_path

ROOT=Path(__file__).resolve().parent
KEYS=['source_id','owner','due','status','risk']

def parse_json(raw):
    try: return json.loads(raw.strip())
    except (ValueError,TypeError): return None

def valid_schema(parsed):
    if not isinstance(parsed,dict) or set(parsed)!=set(KEYS): return False
    if not isinstance(parsed['source_id'],str) or not parsed['source_id']: return False
    if parsed['owner'] is not None and not isinstance(parsed['owner'],str): return False
    if parsed['due'] is not None:
        try:
            if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',parsed['due']): return False
            datetime.strptime(parsed['due'],'%Y-%m-%d')
        except (ValueError,TypeError): return False
    return parsed['status'] in ['todo','active','blocked','review','done','unknown'] and parsed['risk'] in ['low','medium','high','unknown']

def score(raw, expected):
    strict=parse_json(raw)
    # Only render-format normalisation. No field repair, translating or inferred values.
    unwrapped=re.sub(r'^```(?:json)?\s*([\s\S]*?)\s*```$',r'\1',raw.strip())
    parsed=parse_json(unwrapped)
    correct={k:bool(isinstance(parsed,dict) and k in parsed and parsed[k]==expected[k]) for k in KEYS}
    return {'parsed':parsed,'jsonValid':valid_schema(strict),'normalizedJsonValid':valid_schema(parsed),'correct':correct}

def metrics(results):
    n=len(results)
    return {'jsonValidRate':sum(r['jsonValid'] for r in results)/n,'normalizedJsonValidRate':sum(r['normalizedJsonValid'] for r in results)/n,'sourceGroundingRate':sum(r['correct']['source_id'] for r in results)/n,'fieldAccuracy':sum(sum(r['correct'].values()) for r in results)/(n*5),'exactMatchRate':sum(all(r['correct'].values()) for r in results)/n,'strictExactMatchRate':sum(r['jsonValid'] and all(r['correct'].values()) for r in results)/n}

def evaluate(adapter=None):
    started=time.time(); mx.random.seed(20261029)
    model,tokenizer=load(model_path(),adapter_path=adapter)
    data=json.loads((ROOT/'data/test.records.json').read_text())
    results=[]
    for row in data:
        prompt=tokenizer.apply_chat_template(row['messages'][:2],tokenize=False,add_generation_prompt=True,enable_thinking=False)
        t=time.perf_counter()
        raw=generate(model,tokenizer,prompt=prompt,max_tokens=160,sampler=make_sampler(temp=0),verbose=False)
        elapsed=time.perf_counter()-t
        scored=score(raw,row['expected'])
        results.append({'id':row['id'],'family':row['family'],'input':row['note'],'expected':row['expected'],'raw':raw,**scored,'seconds':round(elapsed,3)})
        print(f'{"adapter" if adapter else "base"} {row["id"]}: valid={scored["jsonValid"]} fields={sum(scored["correct"].values())}/5 seconds={elapsed:.2f}',flush=True)
    n=len(results)
    return {'model':MODEL,'modelRevision':REVISION,'adapter':str(adapter) if adapter else None,'createdAt':datetime.now(timezone.utc).isoformat(),'hardware':platform.machine(),'seed':20261029,'temperature':0,'maxTokens':160,'samples':n,'datasetSha256':hashlib.sha256((ROOT/'data/test.jsonl').read_bytes()).hexdigest(),'metrics':metrics(results),'metricProtocol':'Strict JSON requires unfenced valid schema. Field/source/exact-match metrics strip only a single Markdown code fence; no corrections or translations.','elapsedSeconds':round(time.time()-started,2),'predictions':results}

if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--adapter'); parser.add_argument('--output',required=True); args=parser.parse_args()
    output=evaluate(args.adapter)
    Path(args.output).write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(output['metrics'],indent=2))
