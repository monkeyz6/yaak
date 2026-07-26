ALTER TABLE http_requests
    ADD COLUMN post_response_actions TEXT DEFAULT '[]' NOT NULL;
