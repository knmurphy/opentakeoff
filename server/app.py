"""OpenTakeoff AI sandbox — an OPTIONAL, bring-your-own-model backend.

This server is not required to use OpenTakeoff. The takeoff canvas runs entirely
in the browser. What this adds is a *socket*: a small set of takeoff-scoped AI
endpoints you can wire your own local model behind (Ollama, a local vision model,
whatever) to experiment — auto-suggest a scale, detect rooms, classify a finish.

It ships EMPTY of any trained model: the default adapter is a transparent
heuristic so every endpoint works out of the box and shows you the contract.
Swap in your own by setting OPENTAKEOFF_ADAPTER to an import path that resolves
to a `TakeoffAI` implementation (see adapters/base.py and adapters/heuristic.py).

It deliberately does NOT include any estimate, pricing, risk, or scope engine —
this is just the takeoff canvas's optional AI playground.

Run:  uvicorn app:app --reload --port 8000
"""
from __future__ import annotations

import importlib
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from adapters.base import TakeoffAI
from adapters.heuristic import HeuristicAdapter

app = FastAPI(title="OpenTakeoff AI sandbox", version="0.1.0")

# Wide-open CORS by default — this is a local dev sandbox. Lock it down if you
# expose it beyond localhost.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _load_adapter() -> TakeoffAI:
    """Resolve OPENTAKEOFF_ADAPTER ("package.module:Factory") or fall back to the
    built-in heuristic. The factory may be a class or a zero-arg callable."""
    spec = os.environ.get("OPENTAKEOFF_ADAPTER", "").strip()
    if not spec:
        return HeuristicAdapter()
    mod_name, _, attr = spec.partition(":")
    mod = importlib.import_module(mod_name)
    factory = getattr(mod, attr or "Adapter")
    return factory()


adapter: TakeoffAI = _load_adapter()


# ── request/response models ──────────────────────────────────────────────────
class SuggestScaleIn(BaseModel):
    page_text: str = ""


class SuggestScaleOut(BaseModel):
    label: str | None = None
    confidence: float = 0.0
    source: str = "none"


class DetectRoomsIn(BaseModel):
    width: int
    height: int
    # optional flat boundary segments [x1,y1,x2,y2,...] in image px, if the
    # caller already extracted vector linework client-side
    segments: list[float] = []


class Room(BaseModel):
    verts: list[list[float]]
    area_px: float = 0.0


class DetectRoomsOut(BaseModel):
    rooms: list[Room] = []
    note: str = ""


class ClassifyFinishIn(BaseModel):
    context: str = ""


class ClassifyFinishOut(BaseModel):
    finish: str | None = None
    confidence: float = 0.0


# ── routes ───────────────────────────────────────────────────────────────────
@app.get("/health")
def health() -> dict:
    return {"ok": True, "adapter": adapter.name}


@app.post("/ai/suggest-scale", response_model=SuggestScaleOut)
def suggest_scale(body: SuggestScaleIn) -> SuggestScaleOut:
    return SuggestScaleOut(**adapter.suggest_scale(body.page_text))


@app.post("/ai/detect-rooms", response_model=DetectRoomsOut)
def detect_rooms(body: DetectRoomsIn) -> DetectRoomsOut:
    out = adapter.detect_rooms(body.width, body.height, body.segments)
    return DetectRoomsOut(**out)


@app.post("/ai/classify-finish", response_model=ClassifyFinishOut)
def classify_finish(body: ClassifyFinishIn) -> ClassifyFinishOut:
    return ClassifyFinishOut(**adapter.classify_finish(body.context))
