from uuid import uuid4

def make_project_payload():
    suffix = uuid4().hex[:8]
    return {
        "title": f"pytest-title-{suffix}",
        "summary": f"pytest-summary-{suffix}",
    }

