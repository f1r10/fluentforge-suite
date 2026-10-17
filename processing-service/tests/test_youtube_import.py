import pytest

from app.worker import _validate_upload_url, _validate_youtube_url


@pytest.mark.parametrize(
    "url",
    [
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtube.com/shorts/abc123",
        "https://m.youtube.com/watch?v=abc123",
        "https://youtu.be/abc123",
    ],
)
def test_accepts_single_youtube_urls(url: str):
    _validate_youtube_url(url)


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com/watch?v=abc123",
        "http://youtube.com.evil.example/watch?v=abc123",
        "file:///etc/passwd",
        "ftp://youtube.com/video",
    ],
)
def test_rejects_non_youtube_urls(url: str):
    with pytest.raises(ValueError):
        _validate_youtube_url(url)


def test_rejects_playlist_imports():
    with pytest.raises(ValueError, match="Playlist"):
        _validate_youtube_url(
            "https://www.youtube.com/watch?v=abc123&list=PL123"
        )


def test_upload_target_respects_allowlist(monkeypatch):
    monkeypatch.setenv(
        "PROCESSING_ALLOWED_UPLOAD_HOSTS",
        "app,storage.example.test",
    )
    _validate_upload_url(
        "http://app:3000/api/runtime-storage/upload?token=test"
    )
    _validate_upload_url(
        "https://storage.example.test/object/upload/sign/media/test?token=x"
    )

    with pytest.raises(ValueError, match="allow-listed"):
        _validate_upload_url("https://evil.example/upload")
