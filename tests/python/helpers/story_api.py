from helpers.story_data import make_project_payload

def create_story_project(client, admin_headers, payload):
    response = client.post(
        url = "/api/v1/admin/story/projects",
        headers = admin_headers,
        json = payload,
    )

    assert response.status_code == 201, response.text
    return response.json()

# def create_story_document(client, admin_headers, payload)