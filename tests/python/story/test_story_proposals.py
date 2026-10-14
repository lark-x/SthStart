def test_story_proposals(client, admin_headers, story_project):
    project_url = "api/v1/admin/story/projects"

    project_id = story_project["id"]
    orginal_title = "test-orginal-title"
    orginal_body = "test-orginal-body"
    res_create_document = client.post(
        f"{project_url}/{project_id}/documents",
        headers=admin_headers,
        json={
            "title":orginal_title,
            "kind":"chapter",
            "body":orginal_body,
        },
    )
    assert res_create_document.status_code == 201

    chapter = res_create_document.json()
    revision = chapter["revision"]
    res_create_session = client.post(
        f"{project_url}/{project_id}/sessions",
        headers=admin_headers,
        json={
            "title":"test_session_title",
        },
    )
    assert res_create_session.status_code == 201

    session = res_create_session.json()

    proposed_title = "test-proposed-title"
    proposed_body = "test-proposed-body"
    
    res_create_proposals = client.post(
        f"{project_url}/{project_id}/proposals",
        headers=admin_headers,
        json={
            "sessionId":session["id"],
            "kind":"chapter",
            "targetId":chapter["id"],
            "baseRevision":chapter["revision"],
            "proposedTitle":proposed_title,
            "proposedBody":proposed_body,
            "reason":"test_reason",
        },
    )
    assert res_create_proposals.status_code == 201
    assert res_create_proposals.json()["status"] == "pending"

    proposal = res_create_proposals.json()
    proposal_id =proposal["id"]

    res_before = client.get(
        f"{project_url}/{project_id}/documents",
        headers=admin_headers,
    )
    assert res_before.status_code == 200

    before = res_before.json()
    items = before["items"]
    document = next(
            (item for item in items if item["id"] == chapter["id"]),
            None,
        )

    assert document is not None
    assert document["id"] == chapter["id"]
    assert document["title"] == orginal_title
    assert document["body"] == orginal_body

    res_decision_rejected = client.post(
        f"{project_url}/{project_id}/proposals/{proposal_id}/decision",
        headers=admin_headers,
        json={"decision":"rejected"},
    )
    assert res_decision_rejected.status_code == 200
    assert res_decision_rejected.json()["status"] == "rejected"

    res_after_rejected = client.get(
        f"{project_url}/{project_id}/documents",
        headers=admin_headers,
    )
    assert res_after_rejected.status_code == 200

    after_rejected = res_after_rejected.json()
    items = after_rejected["items"]
    document = next(
            (item for item in items if item["id"] == chapter["id"]),
            None,
        )

    assert document is not None
    assert document["id"] == chapter["id"]
    assert document["title"] == orginal_title
    assert document["body"] == orginal_body

    res_decision_accepted = client.post(
        f"{project_url}/{project_id}/proposals/{proposal_id}/decision",
        headers=admin_headers,
        json={"decision":"accepted"},
    )
    assert res_decision_accepted.status_code == 409
    assert res_decision_accepted.json()["error"] == "story_proposal_decided"

    proposed_title_02 = "test-proposed-title-02"
    proposed_body_02 = "test-proposed-body-02"
    
    res_create_proposals_02 = client.post(
        f"{project_url}/{project_id}/proposals",
        headers=admin_headers,
        json={
            "sessionId":session["id"],
            "kind":"chapter",
            "targetId":chapter["id"],
            "baseRevision":chapter["revision"],
            "proposedTitle":proposed_title_02,
            "proposedBody":proposed_body_02,
            "reason":"test_reason_02",
        },
    )
    assert res_create_proposals_02.status_code == 201
    assert res_create_proposals_02.json()["status"] == "pending"

    proposal_02 = res_create_proposals_02.json()
    proposal_id_02 =proposal_02["id"]

    res_decision_accepted_02 = client.post(
        f"{project_url}/{project_id}/proposals/{proposal_id_02}/decision",
        headers=admin_headers,
        json={"decision":"accepted"},
    )
    assert res_decision_accepted_02.status_code == 200

    res_after_accepted = client.get(
        f"{project_url}/{project_id}/documents",
        headers=admin_headers,
    )
    assert res_after_accepted.status_code == 200

    after_accepted = res_after_accepted.json()
    items = after_accepted["items"]
    document = next(
            (item for item in items if item["id"] == chapter["id"]),
            None,
        )

    assert document is not None
    assert document["id"] == chapter["id"]
    assert document["title"] == proposed_title_02
    assert document["body"] == proposed_body_02
    assert document["revision"] == revision + 1
