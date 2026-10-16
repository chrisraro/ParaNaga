import pathlib,json,os
r=pathlib.Path.cwd();lock=(r/'pnpm-lock.yaml').read_text(encoding='utf-8');base=r/'node_modules/.pnpm';seen=set();packages=[];notices=[]
for entry in sorted(base.iterdir()):
 nm=entry/'node_modules'
 if not nm.is_dir():continue
 roots=[p for p in nm.iterdir() if p.is_dir() and not p.name.startswith('.') and not p.is_symlink()]
 expanded=[]
 for p in roots:
  expanded.extend(list(p.iterdir()) if p.name.startswith('@') else [p])
 for p in expanded:
  pj=p/'package.json'
  if not pj.exists() or p.is_symlink():continue
  try:meta=json.loads(pj.read_text(encoding='utf-8'))
  except (ValueError,UnicodeError):continue
  key=meta.get('name','')+'@'+meta.get('version','')
  if key in seen or not any(key+suffix in lock for suffix in [':', chr(39)+':', chr(34)+':']):continue
  seen.add(key);texts=[]
  for directory,dirs,files in os.walk(p):
   dirs[:]=[d for d in dirs if d not in ['node_modules','.git','test','tests','docs']]
   for name in files:
    if name.upper().startswith(('LICENSE','LICENCE','COPYING','NOTICE')) and not name.endswith(('.js','.ts','.map','.json')):
     f=pathlib.Path(directory)/name
     if f.stat().st_size<200000:texts.append(str(f.relative_to(p))+'\n'+f.read_text(encoding='utf-8',errors='replace'))
  packages.append(dict(package=key,license=meta.get('license') or 'NOT RECORDED',hasLicenseText=bool(texts)))
  notices.append('\n===== '+key+' | '+str(meta.get('license','NOT RECORDED'))+' =====\n'+'\n\n'.join(texts))
header='ParaNaga third-party software notices\nGenerated from the installed pnpm dependency tree on 2026-10-16. Includes build/test tools as well as runtime packages. Package licenses apply to their respective components; inclusion is not an endorsement or a claim that one license covers the app.\n'
(r/'public/licenses/THIRD-PARTY-NOTICES.txt').write_text(header+'\n'.join(notices),encoding='utf-8');(r/'data/software-license-inventory.json').write_text(json.dumps(packages,indent=2),encoding='utf-8')
print('Packages',len(packages),'missing license metadata',sum(p['license']=='NOT RECORDED' for p in packages),'notice bytes',(r/'public/licenses/THIRD-PARTY-NOTICES.txt').stat().st_size)

