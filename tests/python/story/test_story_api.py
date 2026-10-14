import pytest

def test_no_token(client):
    response = client.get("/api/v1/admin/story/projects")
    assert response.status_code == 401
    assert response.json()["error"] == "unauthorized"

def test_wrong_token(client):
    response = client.get(url="/api/v1/admin/story/projects",headers={"x-sthstart-admin-token":"123"})
    assert response.status_code == 401
    assert response.json()['error'] == 'unauthorized'

def test_correct_token(client,admin_headers):
    response = client.get(url="/api/v1/admin/story/projects",headers=admin_headers)
    assert response.status_code == 200
    assert isinstance(response.json()['items'],list)

def test_create_project(client,admin_headers):
    res_create_project = client.post(
        url="/api/v1/admin/story/projects",
        headers=admin_headers,
        json={"title":"这是测试的新建项目"},
        )

    assert res_create_project.status_code == 201
    assert res_create_project.json()['id'] is not None
    project_id = res_create_project.json()['id']

    res_create_document = client.post(
        url= f"/api/v1/admin/story/projects/{project_id}/documents",
        headers=admin_headers,
        json={
            "kind":"chapter",
            "title" : "测试章节01",
            "body" : "测试内容01",
        },
    )
    assert res_create_document.status_code == 201, res_create_document.text

    create_document = res_create_document.json()
    document_id = create_document['id']
    original_revision  = create_document['revision']

    res_save_document = client.put(
        url=f"/api/v1/admin/story/projects/{project_id}/documents/{document_id}",
        headers=admin_headers,
        json={
                    "expectedRevision":original_revision ,
                    "title" : "测试章节01-修改测试",
                    "body" : "测试内容01-修改测试",
                },
    )
    assert res_save_document.status_code == 200, res_save_document.text

    saved_document = res_save_document.json()
    expected_revision = original_revision + 1
    assert saved_document['revision'] == expected_revision
    

    res_read_document = client.get(
        url=f"/api/v1/admin/story/projects/{project_id}/documents",
        headers=admin_headers,
    )
    assert res_read_document.status_code == 200, res_read_document.text

    items = res_read_document.json()["items"]
    document = next(
        (item for item in items if item["id"] == document_id),
        None,
    )

    assert document is not None
    assert document["title"] == "测试章节01-修改测试"
    assert document["body"] == "测试内容01-修改测试"
    assert document["revision"] == expected_revision


def test_story_revision_conflict(client,admin_headers):
    res_create_project = client.post(
        url=f"/api/v1/admin/story/projects",
        headers=admin_headers,
        json={"title":"新建项目"}
    )
    assert res_create_project.status_code == 201
    assert res_create_project.json()['id'] is not None

    project_id = res_create_project.json()['id']

    res_create_document = client.post(
        url= f"/api/v1/admin/story/projects/{project_id}/documents",
        headers=admin_headers,
        json={
            "kind":"chapter",
            "title" : "测试章节01",
            "body" : "测试内容01",
        },
    )
    assert res_create_document.status_code == 201, res_create_document.text

    create_document = res_create_document.json()
    document_id = create_document['id']
    original_revision  = create_document['revision']    

    res_save_document = client.put(
        url=f"/api/v1/admin/story/projects/{project_id}/documents/{document_id}",
        headers=admin_headers,
        json={
                    "expectedRevision":original_revision ,
                    "title" : "测试章节01-修改测试",
                    "body" : "测试内容01-修改测试",
                },
    )
    assert res_save_document.status_code == 200, res_save_document.text

    saved_document = res_save_document.json()
    expected_revision = original_revision + 1
    assert saved_document['revision'] == expected_revision

    res_save_document_wrong_revision = client.put(
            url=f"/api/v1/admin/story/projects/{project_id}/documents/{document_id}",
            headers=admin_headers,
            json={
                        "expectedRevision":original_revision ,
                        "title" : "测试章节01-修改测试",
                        "body" : "测试内容01-修改测试-wrong",
                    },
        )
    assert res_save_document_wrong_revision.status_code == 409
    assert res_save_document_wrong_revision.json()["error"] == "story_revision_conflict"

    res_read_document = client.get(
        url=f"/api/v1/admin/story/projects/{project_id}/documents",
        headers=admin_headers,
    )
    assert res_read_document.status_code == 200, res_read_document.text

    items = res_read_document.json()["items"]
    document = next(
        (item for item in items if item["id"] == document_id),
        None,
    )

    assert document is not None
    assert document["body"] == "测试内容01-修改测试"
    assert document["revision"] == expected_revision


def test_empty_title(client,admin_headers):
    res_create_project = client.post(
        url=f"/api/v1/admin/story/projects",
        headers=admin_headers,
        json={"title":"新建项目"}
    )
    assert res_create_project.status_code == 201
    assert res_create_project.json()['id'] is not None

    project_id = res_create_project.json()['id']

    res_create_document = client.post(
        url= f"/api/v1/admin/story/projects/{project_id}/documents",
        headers=admin_headers,
        json={
            "kind":"chapter",
            "title" : "测试章节01",
            "body" : "测试内容01",
        },
    )
    assert res_create_document.status_code == 201, res_create_document.text

    create_document = res_create_document.json()
    document_id = create_document['id']
    original_title = create_document['title']
    original_body = create_document['body']
    original_revision  = create_document['revision']    

    res_save_document_empty_title = client.put(
        url=f"/api/v1/admin/story/projects/{project_id}/documents/{document_id}",
        headers=admin_headers,
        json={
                    "expectedRevision":original_revision ,
                    "title" : "",
                    "body" : "测试内容01-修改测试-空字符串标题",
                },
    )
    assert res_save_document_empty_title.status_code == 400

    res_read_document = client.get(
        url=f"/api/v1/admin/story/projects/{project_id}/documents",
        headers=admin_headers,
    )
    assert res_read_document.status_code == 200, res_read_document.text

    items = res_read_document.json()["items"]
    document = next(
        (item for item in items if item["id"] == document_id),
        None,
    )

    assert document is not None
    assert document["title"] == original_title
    assert document["body"] == original_body
    assert document["revision"] == original_revision

@pytest.mark.parametrize(
    ("title_length", "expected_status"),
    [
        (0, 400),
        (1, 201),
        (120, 201),
        (121, 400),
    ],
)
def test_project_title_length(client, admin_headers, title_length, expected_status):
    res_create_project = client.post(
        url="api/v1/admin/story/projects",
        headers=admin_headers,
        json={
            "title": "a" * title_length,
        }
    )
    assert res_create_project.status_code == expected_status

@pytest.mark.parametrize(
    ("title_length", "expected_status"),
    [
        (0, 400),
        (1, 201),
        (120, 201),
        (121, 400),
    ],
)
def test_document_title_length(client, admin_headers, title_length, expected_status):
    res_create_project = client.post(
        url="api/v1/admin/story/projects",
        headers=admin_headers,
        json={
            "title": "test_project_title",
        }
    )
    assert res_create_project.status_code == 201

    project_id = res_create_project.json()['id']
    res_create_document = client.post(
        url= f"/api/v1/admin/story/projects/{project_id}/documents",
        headers=admin_headers,
        json={
            "kind":"chapter",
            "title" : "a" * title_length,
            "body" : "测试内容01",
        },
        )
    assert res_create_document.status_code == expected_status, res_create_document.text



@pytest.mark.parametrize(
    ("body_length", "expected_status"),
    [
        (0, 201),
        (100000, 201),
        (100001, 400),
    ],
)
def test_document_body_length(client, admin_headers, body_length, expected_status):
    res_create_project = client.post(
        url="api/v1/admin/story/projects",
        headers=admin_headers,
        json={
            "title": "测试项目01",
        }
    )
    assert res_create_project.status_code == 201

    project_id = res_create_project.json()['id']
    body = "a" * body_length
    res_create_document = client.post(
        url= f"/api/v1/admin/story/projects/{project_id}/documents",
        headers=admin_headers,
        json={
            "kind":"chapter",
            "title" : "测试标题",
            "body" : body,
        },
    )
    assert res_create_document.status_code == expected_status,res_create_document.text
    if res_create_document.status_code == 201:
        assert res_create_document.json()["body"] == body
        assert res_create_document.json()["title"] == "测试标题"

def test_permission(client, admin_headers):
    res_create_project = client.post(
        url="api/v1/admin/story/projects",
        headers=admin_headers,
        json={"title":"test_project_title_01"}
    )
    assert res_create_project.status_code == 201
    assert res_create_project.json()["id"] is not None

    project_id = res_create_project.json()["id"]

    res_create_document = client.post(
        url=f"api/v1/admin/story/projects/{project_id}/documents",
        headers=admin_headers,
        json={"title":"test_document_title_01",
              "kind":"chapter",
              "body":"test_body_01",},
    )
    assert res_create_document.status_code == 201

    before = client.get(
        url=f"api/v1/admin/story/projects/{project_id}/documents",
        headers=admin_headers,
    )
    assert before.status_code == 200

    created_document_id = res_create_document.json()["id"]
    before_ids = {item["id"] for item in before.json()["items"]}
    assert created_document_id in before_ids

    res_create_document_with_no_token = client.post(
            url=f"api/v1/admin/story/projects/{project_id}/documents",
            json={"title":"test_document_title_02_no_token",
                  "kind":"chapter",
                  "body":"test_body_02_no_token"},
        )
    assert res_create_document_with_no_token.status_code == 401

    res_create_document_with_wrong_token = client.post(
            url=f"api/v1/admin/story/projects/{project_id}/documents",
            headers={"x-sthstart-admin-token":"wrong_token"},
            json={"title":"test_document_title_03_wrong_token",
                  "kind":"chapter",
                  "body":"test_body_03_wrong_token"},
        )
    assert res_create_document_with_wrong_token.status_code == 401

    after = client.get(
        url=f"api/v1/admin/story/projects/{project_id}/documents",
        headers=admin_headers,
    )
    assert after.status_code == 200

    after_ids = {item["id"] for item in after.json()["items"]}
    assert after_ids == before_ids
    
    res_create_project_with_no_token = client.post(
        url="api/v1/admin/story/projects",
        json={"title":"create_project_with_no_token"},
    )
    assert res_create_project_with_no_token.status_code == 401

    res_create_project_with_wrong_token = client.post(
        url="api/v1/admin/story/projects",
        headers={"x-sthstart-admin-token":"wrong_token"},
        json={"title":"create_project_with_no_token"},
    )
    assert res_create_project_with_wrong_token.status_code == 401



    