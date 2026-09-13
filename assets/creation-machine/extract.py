"""Extract verified local asset packs. Python 3; no network or dependencies."""
from pathlib import Path, PurePosixPath
import hashlib,json,zipfile,argparse
def digest(data):return hashlib.sha256(data).hexdigest()
def extract(root,destination):
    manifest=json.loads((root/'transfer-manifest.json').read_text())
    destination=destination.resolve()
    # Preflight every archive and member before writing.
    for pack in manifest['packs']:
        archive=root/pack['path']
        if digest(archive.read_bytes())!=pack['sha256']:raise ValueError('Archive checksum mismatch: '+str(archive))
        with zipfile.ZipFile(archive) as z:
            if sorted(z.namelist())!=sorted(pack['members']):raise ValueError('Archive membership mismatch')
            for name in z.namelist():
                path=PurePosixPath(name)
                if path.is_absolute() or '..' in path.parts:raise ValueError('Unsafe member path')
                target=(destination/name).resolve()
                if not target.is_relative_to(destination):raise ValueError('Destination escape')
                data=z.read(name);expected=manifest['files'][name]
                if len(data)!=expected['bytes'] or digest(data)!=expected['sha256']:raise ValueError('Member checksum mismatch: '+name)
                if target.exists() and (not target.is_file() or digest(target.read_bytes())!=expected['sha256']):
                    raise ValueError('Refusing to overwrite changed file: '+str(target))
    for pack in manifest['packs']:
        with zipfile.ZipFile(root/pack['path']) as z:
            for name in z.namelist():
                target=destination/name;target.parent.mkdir(parents=True,exist_ok=True)
                if not target.exists():target.write_bytes(z.read(name))
    print('Verified and extracted',manifest['assets'],'assets and',manifest['model_variants'],'model variants to',destination)
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path)
    args=p.parse_args();root=Path(__file__).resolve().parent
    extract(root,args.output or root/'extracted')
