-- The same-origin upload fallback can replace an incomplete object left by an
-- interrupted signed upload. Keep that repair path private to the owner folder.
create policy "learning_material_objects_owner_update" on storage.objects
for update to authenticated
using (
  bucket_id = 'learning-materials'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'learning-materials'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
