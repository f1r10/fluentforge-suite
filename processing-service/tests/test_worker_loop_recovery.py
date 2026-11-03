"""Regression: a transient queue error must not kill the sole import worker."""
import threading

from app import worker


def test_worker_retries_after_claim_error(monkeypatch):
    stop = threading.Event()
    calls = []

    def claim():
        calls.append(True)
        if len(calls) == 1:
            raise RuntimeError("temporary database lock")
        stop.set()
        return None

    monkeypatch.setattr(worker, "_STOP", stop)
    monkeypatch.setattr(worker, "claim_next_job", claim)
    monkeypatch.setattr(stop, "wait", lambda seconds: None)

    worker._loop()

    assert len(calls) == 2
