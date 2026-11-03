import { Button } from '@/components/ui/button';
import { requestRoleAction } from '@/app/roles/actions';

export function AskToEditButton({ pending, returnTo }: { pending: boolean; returnTo: string }) {
  if (pending) return <Button size="sm" variant="outline" disabled>Edit request pending</Button>;
  return (
    <form action={requestRoleAction}>
      <input type="hidden" name="role" value="wiki-editor" />
      <input type="hidden" name="returnTo" value={returnTo} />
      <Button type="submit" size="sm" variant="outline">Ask to edit</Button>
    </form>
  );
}
