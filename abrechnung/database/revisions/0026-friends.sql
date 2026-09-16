-- migration: 3d5b8e21
-- requires: 7a1c9f04

-- Friendships, so inviting someone you split with regularly is one tap.
-- One row per pair, in whichever direction the request went: accepted_at null
-- means it is still a request, set means the two are friends. The unique index
-- on the unordered pair is what stops both sides having an open request at once.
create table friend_request (
    id serial primary key,
    from_user_id int not null references usr (id) on delete cascade,
    to_user_id int not null references usr (id) on delete cascade,
    accepted_at timestamptz,
    created_at timestamptz not null default now(),
    check (from_user_id <> to_user_id)
);
create unique index friend_request_pair on friend_request (least(from_user_id, to_user_id), greatest(from_user_id, to_user_id));

-- The personal quick-add link. Whoever opens it while logged in becomes a
-- friend immediately, so it is a secret and gets its own column rather than
-- anything derived from the user id.
alter table usr add column friend_token uuid not null default gen_random_uuid();
create unique index usr_friend_token on usr (friend_token);
