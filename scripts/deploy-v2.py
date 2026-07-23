#!/usr/bin/env python3
# scripts/deploy-v2.py — v2(Neo4j) 앱 + pyservice 를 FEDA K8s 에 원샷 배포.
# 왜 있나: 마스터 ~/sl-ontoground 는 git 아닌 SFTP 트리라 "변경 파일만 덮기"가
# 새 디렉토리에서 실패한다 → 매번 전체 트리를 tar 로 재동기화한다. 태그는 배포 중인
# 이미지에서 자동 +1. 자세한 배경/수동 절차는 docs/deployment.md "v2 배포 런북".
#
# 사용:  FEDA_PW='<ssh 비번>' python scripts/deploy-v2.py
#   앱만:        FEDA_PW=... python scripts/deploy-v2.py --app
#   pyservice만: FEDA_PW=... python scripts/deploy-v2.py --py
# 비번을 명령행에 쓰지 말 것(쉘 히스토리에 남는다) — 환경변수로만.
import io, os, sys, tarfile, posixpath, argparse

try:
    import paramiko
except ImportError:
    sys.exit("paramiko 필요: pip install paramiko")

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST, USER = "192.168.0.100", "feda"
REG = "192.168.0.100:5000"
REMOTE = "/home/feda/sl-ontoground"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXCLUDE = {"node_modules", ".next", ".git", "docs", "eval"}  # 빌드에 불필요 → 전송 제외

APP = dict(ns="sl-ontoground-v2", deploy="sl-ontoground-v2", container="web",
           repo="sl-ontoground-v2", ctx=".")
PY = dict(ns="sl-ontoground", deploy="pyservice", container="pyservice",
          repo="sl-ontoground-pyservice", ctx="pyservice/")

ap = argparse.ArgumentParser()
ap.add_argument("--app", action="store_true")
ap.add_argument("--py", action="store_true")
args = ap.parse_args()
do_app = args.app or not args.py
do_py = args.py or not args.app

pw = os.environ.get("FEDA_PW")
if not pw:
    sys.exit("FEDA_PW 환경변수에 SSH 비번을 넣어라")

def log(m): print(m, flush=True)

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=pw, timeout=20)

def run(cmd, timeout=2400):
    log(f"\n$ {cmd}")
    ch = c.get_transport().open_session(); ch.settimeout(timeout); ch.exec_command(cmd)
    while True:
        if ch.recv_ready(): sys.stdout.write(ch.recv(65536).decode("utf-8", "replace")); sys.stdout.flush()
        if ch.recv_stderr_ready(): sys.stdout.write(ch.recv_stderr(65536).decode("utf-8", "replace")); sys.stdout.flush()
        if ch.exit_status_ready() and not ch.recv_ready() and not ch.recv_stderr_ready(): break
    rc = ch.recv_exit_status(); log(f"[rc={rc}]")
    if rc != 0: log("!!! FAIL — abort"); c.close(); sys.exit(1)
    return rc

def out(cmd):
    _, o, _ = c.exec_command(cmd, timeout=40)
    return o.read().decode("utf-8", "replace").strip()

def next_tag(d):
    # 배포 중 이미지의 :vN 에서 +1. 못 읽으면 중단(멋대로 v1 찍지 않는다).
    img = out("kubectl -n %s get deploy %s -o jsonpath='{..image}'" % (d["ns"], d["deploy"]))
    cur = img.rsplit(":v", 1)
    if len(cur) != 2 or not cur[1].isdigit():
        c.close(); sys.exit(f"현재 태그 파싱 실패: {img!r}")
    return f"{REG}/{d['repo']}:v{int(cur[1]) + 1}", img

# 1) 전체 트리 tar → SFTP (마스터 트리 stale 대비 매번 재동기화)
log("=== tar + SFTP 전체 트리 ===")
buf = io.BytesIO()
with tarfile.open(fileobj=buf, mode="w:gz") as t:
    for root, dirs, files in os.walk(REPO):
        dirs[:] = [d for d in dirs if d not in EXCLUDE]
        for f in files:
            if f.endswith(".zip"): continue
            fp = os.path.join(root, f)
            t.add(fp, arcname=os.path.relpath(fp, REPO).replace("\\", "/"))
buf.seek(0)
sf = c.open_sftp(); sf.putfo(buf, "/home/feda/deploy.tgz"); sf.close()
log(f"  전송 {buf.getbuffer().nbytes // 1024}KB")

run("cd ~ && rm -rf sl-ontoground.bak && mv sl-ontoground sl-ontoground.bak && "
    "mkdir sl-ontoground && tar xzf deploy.tgz -C sl-ontoground && "
    "test -f sl-ontoground/app/api/v2/canvases/route.ts && echo TREE_OK")

# 2) 빌드 · 푸시 · 롤아웃
if do_app:
    img, old = next_tag(APP); log(f"\n### 앱: {old} → {img}")
    run(f"cd {REMOTE} && docker build -t {img} {APP['ctx']}")
    run(f"docker push {img}")
    run(f"kubectl -n {APP['ns']} set image deploy/{APP['deploy']} {APP['container']}={img}")
    run(f"kubectl -n {APP['ns']} rollout status deploy/{APP['deploy']} --timeout=300s")

if do_py:
    img, old = next_tag(PY); log(f"\n### pyservice: {old} → {img}")
    run(f"cd {REMOTE} && docker build -t {img} {PY['ctx']}")  # e5 모델 다운로드로 수분
    run(f"docker push {img}")
    run(f"kubectl -n {PY['ns']} set image deploy/{PY['deploy']} {PY['container']}={img}")
    run(f"kubectl -n {PY['ns']} rollout status deploy/{PY['deploy']} --timeout=300s")

log("\n=== DEPLOY OK ===")
run("PORT=$(kubectl get svc -n sl-ontoground-v2 -o jsonpath='{.items[?(@.spec.type==\"NodePort\")].spec.ports[0].nodePort}'); "
    "echo v2=http://192.168.0.100:$PORT/v2; curl -s -m 15 http://192.168.0.100:$PORT/api/v2/canvases; echo")
c.close()
