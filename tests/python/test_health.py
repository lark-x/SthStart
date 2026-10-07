import httpx

def test_health():
    rq = httpx.get(
        url='http://127.0.0.1:4102/api/v1/health',
        timeout=5.0,
    )
    assert rq.status_code == 200
    assert rq.json()['status'] == 'ok'
    assert rq.json()['service'] == 'sthstart-service'
