from pathlib import Path
import os,re,subprocess,json,shutil,time
root=Path('<repo>');base=Path('/tmp/yova-brief-0')
files=sorted(root.glob('src/**/*.live.test.ts'));launch=root/'src/evals/launch-session-journeys.live.test.ts';files=[launch]+[p for p in files if p!=launch]
env=os.environ.copy()
for p in files:
 for flag in re.findall(r'YOVA_RUN_LIVE_[A-Z_]+',p.read_text()):env[flag]='1'
 for flag in re.findall(r'YOVA_[A-Z_]*EVAL_CASE|YOVA_LAUNCH_CASE',p.read_text()):env[flag]=''
env['YOVA_RUN_LIVE_BROWSER_CANARY']='1'
(base/'baseline-manifest.json').write_text(json.dumps({'commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'files':[str(p.relative_to(root)) for p in files],'runs':3,'browserClock':'2026-09-07T19:35:00.000Z','browserFixture':'fresh producer output in each complete run'},indent=2))
legacy=root/'docs/audits/2026-09-07-plan-creation/consolidated/evidence';legacy.mkdir(parents=True,exist_ok=True)
for run in range(1,4):
 out=base/f'baseline-{run}';out.mkdir(exist_ok=True);results=[]
 # Never let a failed producer silently reuse a previous run's data.
 for name in ['calculus','osmosis','recall']:
  for suffix in ['result','lessons']:
   p=Path(f'/tmp/yova-launch-regressions/{name}-{suffix}.json')
   if p.exists():p.unlink()
 for name in ['live-ten-minute.json','live-ten-minute-provider.json']:
  p=legacy/name
  if p.exists():p.unlink()
 for p in files:
  name=p.name.removesuffix('.live.test.ts');logpath=out/f'{name}.txt'
  print(f'Run {run}/3: {p.relative_to(root)}',flush=True)
  with logpath.open('w') as log:
   log.write(f'Main e03a082 complete baseline {run}/3. Serial, all existing live opt-ins enabled, case filters cleared.\n');log.flush()
   result=subprocess.run(['node','--env-file=.env.local','node_modules/vitest/vitest.mjs','run',str(p.relative_to(root)),'--maxWorkers=1','--reporter=default','--reporter=json',f'--outputFile={out/name}.json'],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
   log.write(f'\nExit code: {result.returncode}\n')
  results.append({'file':str(p.relative_to(root)),'exitCode':result.returncode})
  (out/'run-results.json').write_text(json.dumps(results,indent=2));print(f'Run {run}: {name}: exit {result.returncode}',flush=True)
 for name in ['live-ten-minute.json','live-ten-minute-provider.json']:
  if (legacy/name).exists():shutil.copy2(legacy/name,out/name)
 if Path('/tmp/yova-launch-regressions').exists():shutil.copytree('/tmp/yova-launch-regressions',out/'launch-fixtures',dirs_exist_ok=True)
 env['YOVA_BASELINE_OUTPUT_DIR']=str(out)
 print(f'Run {run}/3: desktop + mobile live browser journeys',flush=True)
 with (out/'browser.txt').open('w') as log:
  result=subprocess.run(['node','--env-file=.env.local','node_modules/@playwright/test/cli.js','test','e2e/plan-launch-live.spec.ts','--config','playwright.brief0-baseline.config.ts'],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
  log.write(f'\nExit code: {result.returncode}\n')
 results.append({'file':'e2e/plan-launch-live.spec.ts','exitCode':result.returncode});(out/'run-results.json').write_text(json.dumps(results,indent=2))
 print(f'COMPLETE BASELINE {run}/3; live files={len(files)}, browser exit={result.returncode}',flush=True)
print('All three complete main runs finished.',flush=True)
