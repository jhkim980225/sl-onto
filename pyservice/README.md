# pyservice — stateless embedding sidecar

Multilingual (Korean-capable) 384-dim embeddings over HTTP; no DB, no filesystem. Model: `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`.

- Local: `pip install -r requirements.txt` then `uvicorn main:app --port 8000`
- Docker: `docker build -t pyservice .` then `docker run -p 8000:8000 pyservice`
- Endpoints: `GET /health` → `{status,model}`; `POST /embed` `{texts:[...]}` → `{vectors:[[...384 L2-normalized floats...]]}`
