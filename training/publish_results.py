"""Publish measured metrics and artefact hashes without model weights or machine paths."""
import hashlib
import json
import re
import statistics
import argparse
from pathlib import Path
from model_path import MODEL, REVISION

ROOT=Path(__file__).resolve().parent
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--check', action='store_true', help='Recompute and compare the published report without writing files.')
args=parser.parse_args()

def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()

baseline=json.loads((ROOT/'results/baseline.json').read_text())
adapted=json.loads((ROOT/'results/adapted.json').read_text())
manifest=json.loads((ROOT/'data/manifest.json').read_text())
config=json.loads((ROOT/'adapters/adapter_config.json').read_text())
log_path=ROOT/'results/training.log'
if not log_path.exists():
 log_path=ROOT/'results/training.txt'
raw=log_path.read_text()
clean_log=re.sub(r'\x1b\[[0-9;]*m','',raw)
validation=[(int(step),float(loss)) for step,loss in re.findall(r'^\s*(\d+)\s+val\s+([0-9.]+)',clean_log,re.M)]
parameters=re.search(r'Trainable parameters:\s*([0-9.]+)%\s*\(([0-9.]+)M/',clean_log)
assert validation and parameters, 'Training log must include validation losses and parameter counts.'
assert validation[-1][0]==config['iters'], 'Training log must include the final scheduled validation.'
prior_step,prior_loss=validation[-2] if len(validation)>1 else validation[0]
final_step,final_loss=validation[-1]
direction='rose' if final_loss>prior_loss else 'changed'
assert baseline['datasetSha256']==adapted['datasetSha256']==manifest['sha256']['test.jsonl']
report={
 'status':'completed','experiment':'Harbour extraction QLoRA · synthetic holdout v1',
 'model':MODEL,'modelRevision':REVISION,'runAt':adapted['createdAt'],
 'hardware':{'architecture':'Apple Silicon arm64','unifiedMemoryGB':16},
 'task':'Extract source_id, owner, due, status and risk from one bilingual project note',
 'training':{'method':'4-bit QLoRA','steps':config['iters'],'rank':config['lora_parameters']['rank'],'layers':config['num_layers'],'batchSize':config['batch_size'],'learningRate':config['learning_rate'],'seed':config['seed'],'trainableParameters':round(float(parameters.group(2))*1000000),'trainableParameterPercent':float(parameters.group(1)),'initialValidationLoss':validation[0][1],'finalValidationLoss':final_loss,'adapterBytes':(ROOT/'adapters/adapters.safetensors').stat().st_size},
 'dataset':{**manifest,'holdoutSamples':manifest['counts']['test']},
 'baseline':baseline['metrics'],'finetuned':adapted['metrics'],
 'evaluation':{'temperature':0,'maxTokens':160,'samples':16,'fieldComparisons':80,'protocol':adapted['metricProtocol'],'baselineRunSeconds':baseline['elapsedSeconds'],'finetunedRunSeconds':adapted['elapsedSeconds'],'baselineGenerationSeconds':round(sum(r['seconds'] for r in baseline['predictions']),3),'finetunedGenerationSeconds':round(sum(r['seconds'] for r in adapted['predictions']),3),'baselineMedianRecordSeconds':statistics.median(r['seconds'] for r in baseline['predictions']),'finetunedMedianRecordSeconds':statistics.median(r['seconds'] for r in adapted['predictions'])},
 'limitations':[
  'All 128 records are synthetic and contain no personal or customer data. Results describe this controlled experiment only.',
  'Only 16 held-out records from 4 unseen templates were evaluated; common schema and vocabulary are shared. This is a small pilot, not proof of broad generalisation.',
  'The baseline uses Markdown fences. Strict JSON improvement includes formatting; the field score separately removes only a single fence for both models.',
  'One preset 60-step run. Final adapter selected by fixed training schedule, not by holdout results. No hyperparameter search.',
  'The adapter is trained for extraction, not project planning, long reports or autonomous decisions. Human review remains required.',
  f'Validation loss {direction} from {prior_loss} at step {prior_step} to {final_loss} at step {final_step}. More training is not assumed to be better.',
  'Run time includes loading/download overhead. Per-record generation time is reported separately and has not been benchmarked across repeated runs; no speedup claim.'
 ],
 'artifacts':{
  'baseline':'training/results/baseline.json','finetuned':'training/results/adapted.json','trainingLog':'training/results/training.txt','configuration':'training/config.yaml','adapter':'training/adapters/adapters.safetensors','dataManifest':'training/data/manifest.json'
 },
 'sha256':{'adapter':sha(ROOT/'adapters/adapters.safetensors'),'config':sha(ROOT/'config.yaml'),'holdout':sha(ROOT/'data/test.jsonl'),'baselinePredictions':sha(ROOT/'results/baseline.json'),'finetunedPredictions':sha(ROOT/'results/adapted.json')},
 'failures':[{'id':r['id'],'input':r['input'],'expected':r['expected'],'prediction':r['parsed'],'wrongFields':[k for k,v in r['correct'].items() if not v]} for r in adapted['predictions'] if not all(r['correct'].values())]
}
if args.check:
 assert report==json.loads((ROOT.parent/'public/model-evaluation.json').read_text()), 'Published report differs from recomputed artefacts and training metadata.'
 print('PASS: published report matches recomputed artefacts, saved hyperparameters and measured training losses; no files changed.')
else:
 (ROOT.parent/'public/model-evaluation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 (ROOT/'results/training.txt').write_text(clean_log.rstrip()+'\n')
 print(json.dumps({'baseline':report['baseline'],'finetuned':report['finetuned'],'failures':len(report['failures'])},indent=2))
