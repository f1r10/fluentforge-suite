import pytest
import yt_dlp

from app.worker import (
    YOUTUBE_ACCESS_RESTRICTED,
    _is_youtube_access_restricted,
    _process_youtube_import,
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
    assert "no video was saved" in YOUTUBE_ACCESS_RESTRICTED.lower()
    assert "video was not downloaded" in YOUTUBE_ACCESS_RESTRICTED.lower()
    assert "cookies" not in YOUTUBE_ACCESS_RESTRICTED.lower()


def test_unrelated_download_error_not_misclassified():
    assert not _is_youtube_access_restricted(
        ValueError("ERROR: [youtube] abc: Requested format is not available")
    )
    assert not _is_youtube_access_restricted(
        ValueError("ERROR: HTTP Error 502: Bad Gateway")
    )


def test_youtube_worker_uses_supported_js_runtime_and_normalizes_provider_block(monkeypatch):
    captured = {}

    class BlockedYouTube:
        def __init__(self, options):
            captured.update(options)

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def extract_info(self, source_url, download):
            assert source_url == "https://www.youtube.com/watch?v=26PrgjTboVQ"
            assert download is True
            raise yt_dlp.utils.DownloadError(
                "ERROR: [youtube] 26PrgjTboVQ: Sign in to confirm you’re not a bot."
            )

    monkeypatch.setattr("app.worker.yt_dlp.YoutubeDL", BlockedYouTube)
    monkeypatch.setattr("app.worker.update_job", lambda *_args, **_kwargs: None)
    monkeypatch.setenv("PROCESSING_ALLOWED_UPLOAD_HOSTS", "app")
    job = {
        "id": "test-youtube",
        "request": {
            "source_url": "https://www.youtube.com/watch?v=26PrgjTboVQ",
            "upload_url": "http://app:3000/api/runtime-storage/upload?token=testing",
            "max_bytes": 10_000_000,
            "preferred_height": 720,
        },
    }
    with pytest.raises(ValueError, match="YOUTUBE_ACCESS_RESTRICTED"):
        _process_youtube_import(job)
    assert captured["js_runtimes"] == {"node": {}}
    assert captured["noplaylist"] is True
    assert captured["max_filesize"] == 10_000_000
