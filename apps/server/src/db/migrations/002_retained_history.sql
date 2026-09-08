ALTER TABLE tasks ADD COLUMN deleted_at timestamptz;
ALTER TABLE tasks ADD CONSTRAINT task_document CHECK (jsonb_typeof(body)='object' AND body->>'id'=id AND body->>'repositoryId'=repository_id);
ALTER TABLE repositories ADD CONSTRAINT repository_document CHECK (jsonb_typeof(body)='object' AND body->>'id'=id AND body->>'deviceId'=device_id);
ALTER TABLE provider_profiles ADD CONSTRAINT profile_document CHECK (jsonb_typeof(body)='object' AND body->>'id'=id AND body->>'deviceId'=device_id);
ALTER TABLE executions ADD CONSTRAINT execution_document CHECK (jsonb_typeof(body)='object' AND body->>'id'=id AND body->>'taskId'=task_id AND body->>'deviceId'=device_id);
ALTER TABLE sessions ADD CONSTRAINT session_document CHECK (jsonb_typeof(body)='object' AND body->>'id'=id AND body->>'providerProfileId'=profile_id);
