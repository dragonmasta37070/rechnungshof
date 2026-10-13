-- migration: c3d9e7f1
-- requires: b7e4c2a9

-- Deleting a group failed as soon as one of its expenses or accounts had a tag:
-- the tag links still referenced the transaction/account and their revisions
-- without cascading, so the delete of the group's transactions was rejected.
alter table transaction_to_tag drop constraint transaction_to_tag_transaction_id_fkey;
alter table transaction_to_tag add constraint transaction_to_tag_transaction_id_fkey
    foreign key (transaction_id) references transaction (id) on delete cascade;
alter table transaction_to_tag drop constraint transaction_to_tag_revision_id_fkey;
alter table transaction_to_tag add constraint transaction_to_tag_revision_id_fkey
    foreign key (revision_id) references transaction_revision (id) on delete cascade;

alter table account_to_tag drop constraint account_to_tag_account_id_fkey;
alter table account_to_tag add constraint account_to_tag_account_id_fkey
    foreign key (account_id) references account (id) on delete cascade;
alter table account_to_tag drop constraint account_to_tag_revision_id_fkey;
alter table account_to_tag add constraint account_to_tag_revision_id_fkey
    foreign key (revision_id) references account_revision (id) on delete cascade;
