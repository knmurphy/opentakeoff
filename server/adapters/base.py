"""The AI adapter contract — the socket you wire a local model behind.

Implement these three methods and point OPENTAKEOFF_ADAPTER at your class
(e.g. OPENTAKEOFF_ADAPTER="my_adapters.ollama:OllamaAdapter"). Every method
returns a plain dict matching the response models in app.py, so you can return
partial/empty results safely while you experiment.

All three are takeoff-scoped on purpose. There is intentionally no estimate,
pricing, risk, or scope surface here.
"""
from __future__ import annotations

from typing import Protocol, runtime_checkable


@runtime_checkable
class TakeoffAI(Protocol):
    #: human-readable adapter name, surfaced at /health
    name: str

    def suggest_scale(self, page_text: str) -> dict:
        """Given a page's extracted text, suggest a drawing scale.
        Return: {"label": str|None, "confidence": float, "source": str}."""
        ...

    def detect_rooms(self, width: int, height: int, segments: list[float]) -> dict:
        """Given a sheet's pixel dims (and optionally its boundary segments),
        propose room polygons.
        Return: {"rooms": [{"verts": [[x,y],...], "area_px": float}], "note": str}."""
        ...

    def classify_finish(self, context: str) -> dict:
        """Given some context (a label, a note, nearby text), guess the finish.
        Return: {"finish": str|None, "confidence": float}."""
        ...
