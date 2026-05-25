-- Storage bucket for order CSV imports.
-- Private: all reads/writes go through the service-role client.
-- File size limit (10 MB) is enforced here AND in the import route handler.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'orders',
  'orders',
  false,
  10485760,  -- 10 MB in bytes
  ARRAY[
    'text/csv',
    'text/plain',
    'application/csv',
    'application/octet-stream'  -- some OS/browser combos send this for .csv
  ]
)
ON CONFLICT (id) DO NOTHING;
