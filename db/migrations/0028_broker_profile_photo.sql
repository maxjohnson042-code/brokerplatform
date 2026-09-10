-- UI polish: broker profile photo (avatar). Stored as a relative /media/:key path
-- from the new media module (src/modules/media), not evidence — see
-- image-storage.ts's comment on why avatars are mutable/low-sensitivity rather than
-- write-once compliance documents.
ALTER TABLE broker_profiles ADD COLUMN photo_url TEXT;
