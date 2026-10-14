import pytest
import os
import httpx
import socket
import subprocess
import time
from pathlib import Path

from tests.python.helpers.story_api import create_story_project
from tests.python.helpers.story_data import make_project_payload

PROJECT_ROOT = Path(__file__).resolve().parents[2]
TEST_ADMIN_TOKEN = 'sthstart-python-test-only-token-20261010'

def wait_for_service(base_url: str, process: subprocess.Popen)-> None:
    deadline = time.monotonic() + 30
    last_error = "健康接口尚未返回 200"

    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"测试范围提前退出：{last_error}")

        try:
            response = httpx.get(
                f"{base_url}/api/v1/health",
                timeout=0.5,
            )
            if response.status_code == 200:
                return

            last_error = f"健康接口尚未返回 HTTP {response.status_code}"

        except httpx.RequestError as error:
            last_error = str(error)

        time.sleep(0.2)

    raise RuntimeError(f"等待测试服务启动超时：{last_error}")


@pytest.fixture(scope="session")
def api_service(tmp_path_factory):
    data_dir = tmp_path_factory.mktemp("sthstart-api")

    with socket.socket() as port_socket:
        port_socket.bind(("127.0.0.1", 0))
        port = port_socket.getsockname()[1]

    child_env = os.environ.copy()
    child_env.update({
        "SERVICE_HOST": "127.0.0.1",
        "SERVICE_PORT": str(port),
        "STHSTART_ADMIN_TOKEN": TEST_ADMIN_TOKEN,
        "STHSTART_DATABASE_PATH": str(data_dir / "service.db"),
        "STHSTART_NARRATIVE_DATABASE_PATH": str(data_dir / "narrative.db"),
        "STHSTART_ARTIFACT_DIR": str(data_dir / "artifacts"),
        "STHSTART_LOG_DIR": str(data_dir / "logs"),
    })

    base_url = f"http://127.0.0.1:{port}"
    
    process = subprocess.Popen(
        ["node", "--import", "tsx/esm", "apps/service/src/start.ts"],
        cwd=PROJECT_ROOT,
        env=child_env,
    )

    try:
        wait_for_service(base_url, process)
        yield base_url
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()

@pytest.fixture
def base_url(api_service):
    return api_service

@pytest.fixture
def admin_headers():
    return {"x-sthstart-admin-token":TEST_ADMIN_TOKEN}

@pytest.fixture
def client(base_url):
    with httpx.Client(base_url=base_url, timeout=5.0) as http_client:
        yield http_client

@pytest.fixture
def story_project(client, admin_headers):
    return create_story_project(
        client,
        admin_headers,
        make_project_payload(),
    )