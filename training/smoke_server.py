"""Real loopback HTTP inference against the adapter; no mocked model output."""
import json
import time
import urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parent
text='交付记录 SIM-LIVE-01：负责人 DeploymentLead-A；截止日期 2026-11-03；状态受阻；风险高。设备未到货，等待供应商确认。'
expected={'source_id':'SIM-LIVE-01','owner':'DeploymentLead-A','due':'2026-11-03','status':'blocked','risk':'high'}
body={'model':'default_model','messages':[{'role':'system','content':(ROOT/'extraction-system.txt').read_text().strip()},{'role':'user','content':text}],'temperature':0,'max_tokens':160,'stream':False}
request=urllib.request.Request('http://127.0.0.1:8080/v1/chat/completions',data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
start=time.perf_counter()
with urllib.request.urlopen(request,timeout=60) as response: result=json.load(response)
raw=result['choices'][0]['message']['content']
try: parsed=json.loads(raw)
except ValueError: parsed=None
output={'mode':'live-local-http','model':'mlx-community/Qwen3-0.6B-4bit + Harbour QLoRA adapter','endpoint':'127.0.0.1:8080','synthetic':True,'input':text,'expected':expected,'raw':raw,'parsed':parsed,'passed':parsed==expected,'seconds':round(time.perf_counter()-start,3)}
(ROOT/'results/server-smoke.json').write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(output,ensure_ascii=False,indent=2))
raise SystemExit(0 if output['passed'] else 1)
