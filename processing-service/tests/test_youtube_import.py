import pytest

from app.worker import (
    YOUTUBE_ACCESS_RESTRICTED,
    _is_youtube_access_restricted,
    _validate_upload_url,
    _validate_youtube_url,
)


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


@pytest.mark.parametrize(
    "error",
    [
        "ERROR: [youtube] 26PrgjTboVQ: Sign in to confirm you’re not a bot.",
        "ERROR: [youtube] abc: Sign in to confirm you're not a bot.",
        "ERROR: [youtube] abc: This video requires authentication",
        "ERROR: [youtube] abc: Please sign in",
    ],
)
def test_youtube_bot_or_auth_challenge_has_clear_user_safe_message(error: str):
    assert _is_youtube_access_restricted(ValueError(error))
    assert "video was saved" not in YOUTUBE_ACCESS_RESTRICTED.lower()
    assert "video was not downloaded" in YOUTUBE_ACCESS_RESTRICTED.lower()
    assert "cookies" not in YOUTUBE_ACCESS_RESTRICTED.lower()


def test_unrelated_download_error_not_misclassified():
    assert not _is_youtube_access_restricted(
        ValueError("ERROR: [youtube] abc: Requested format is not available")
    )
    assert not _is_youtube_access_restricted(
        ValueError("ERROR: HTTP Error 502: Bad Gateway")
    )
