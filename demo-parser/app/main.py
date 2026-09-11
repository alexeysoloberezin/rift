import shutil
import tempfile
import traceback
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from .parser import parse_demo

app = FastAPI(title="RIFT demo-parser", version="1.0.0")


@app.get("/health")
def health():
    return {"success": True, "status": "ok", "service": "rift-demo-parser"}


@app.post("/parse")
async def parse(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".dem"):
        raise HTTPException(status_code=400, detail="Ожидается файл с расширением .dem")

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir) / file.filename
        with open(tmp_path, "wb") as f:
            shutil.copyfileobj(file.file, f)

        try:
            result = parse_demo(str(tmp_path))
            return result
        except Exception as exc:  # noqa: BLE001 — хотим вернуть внятную ошибку клиенту
            traceback.print_exc()
            return JSONResponse(
                status_code=422,
                content={"success": False, "error": f"Не удалось разобрать демку: {exc}"},
            )
