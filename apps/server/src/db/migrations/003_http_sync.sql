ALTER TABLE users ADD COLUMN revision bigint NOT NULL DEFAULT 0;
ALTER TABLE devices ADD COLUMN sync_session_id text;
ALTER TABLE devices ADD COLUMN sync_token_hash text;
ALTER TABLE devices ADD COLUMN sync_ready boolean NOT NULL DEFAULT false;
ALTER TABLE commands ADD COLUMN delivered_at timestamptz;

-- A persisted agent counter also fences delayed FIRST handshake requests.
ALTER TABLE devices ADD COLUMN sync_generation bigint NOT NULL DEFAULT 0;

-- Revisions commit atomically with domain writes, including scheduler and MCP
-- writes. Identical upserts and heartbeat timestamps do not invalidate clients.
CREATE FUNCTION bump_user_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  UPDATE users SET revision=revision+1 WHERE id=COALESCE(NEW.user_id,OLD.user_id);
  RETURN COALESCE(NEW,OLD);
END $$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tasks','task_dependencies','executions','sessions','repositories','provider_profiles','commands','push_devices'] LOOP
    EXECUTE format('CREATE TRIGGER revision_changed AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION bump_user_revision()', t);
  END LOOP;
END $$;
CREATE TRIGGER revision_device_identity AFTER INSERT OR DELETE OR UPDATE OF name,platform,sync_session_id,sync_token_hash ON devices FOR EACH ROW EXECUTE FUNCTION bump_user_revision();
