import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { getDb } from '@/db';
import type { Task, TaskStatus } from '@/db/schema';
import { listMembers } from '@/lib/members/service';
import { requireUser } from '@/lib/session';
import { listTasks } from '@/lib/tasks/service';
import { assignTaskAction, createTaskAction, deleteTaskAction, updateTaskStatusAction } from './actions';

export const dynamic = 'force-dynamic';

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'backlog', label: 'Backlog' },
  { status: 'doing', label: 'Doing' },
  { status: 'done', label: 'Done' },
];

const selectClass = 'h-8 rounded-md border bg-background px-2 text-sm';

export default async function TasksPage() {
  const user = await requireUser();
  const db = await getDb();
  const [tasks, members] = await Promise.all([listTasks(db, { projectId: null }), listMembers(db)]);
  const nameOf = (id: string | null) => {
    if (!id) return null;
    const m = members.find((x) => x.id === id);
    return m ? m.name || m.email : 'Unknown member';
  };
  const memberOptions = members.map((m) => <option key={m.id} value={m.id}>{m.name || m.email}</option>);

  return (
    <AppShell user={user}>
      <h1 className="mb-4 text-xl font-semibold">Tasks</h1>
      <form action={createTaskAction} className="mb-6 flex flex-wrap items-end gap-2">
        <label className="flex min-w-60 flex-1 flex-col gap-1 text-sm">
          New task
          <input name="description" required placeholder="What needs doing?" className="h-8 rounded-md border bg-background px-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Assignee
          <select name="assigneeUserId" defaultValue="" className={selectClass}>
            <option value="">Unassigned</option>
            {memberOptions}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Image
          <input type="file" name="image" accept="image/*" className="text-sm" />
        </label>
        <Button type="submit">Add task</Button>
      </form>
      <div className="grid gap-4 md:grid-cols-3">
        {COLUMNS.map((col) => (
          <section key={col.status}>
            <h2 className="mb-2 font-medium">{col.label}</h2>
            <div className="flex flex-col gap-2">
              {tasks.filter((t) => t.status === col.status).map((t) => (
                <TaskCard key={t.id} task={t} assignee={nameOf(t.assigneeUserId)} creator={nameOf(t.createdByUserId)} memberOptions={memberOptions} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </AppShell>
  );
}

function TaskCard({ task, assignee, creator, memberOptions }: { task: Task; assignee: string | null; creator: string | null; memberOptions: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-3 text-sm">
      <p className="mb-1 whitespace-pre-wrap">{task.description}</p>
      {task.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={task.imageUrl} alt="" className="mb-2 max-h-40 rounded-md object-cover" />
      )}
      <p className="mb-2 text-xs text-muted-foreground">{assignee ?? 'Unassigned'} · added by {creator}</p>
      <div className="flex flex-wrap items-center gap-2">
        <form action={updateTaskStatusAction} className="flex gap-1">
          <input type="hidden" name="taskId" value={task.id} />
          <select name="status" defaultValue={task.status} className={selectClass} aria-label="Status">
            {COLUMNS.map((c) => <option key={c.status} value={c.status}>{c.label}</option>)}
          </select>
          <Button type="submit" size="sm" variant="outline">Move</Button>
        </form>
        <form action={assignTaskAction} className="flex gap-1">
          <input type="hidden" name="taskId" value={task.id} />
          <select name="assigneeUserId" defaultValue={task.assigneeUserId ?? ''} className={selectClass} aria-label="Assignee">
            <option value="">Unassigned</option>
            {memberOptions}
          </select>
          <Button type="submit" size="sm" variant="outline">Assign</Button>
        </form>
        <form action={deleteTaskAction}>
          <input type="hidden" name="taskId" value={task.id} />
          <Button type="submit" size="sm" variant="destructive">Delete</Button>
        </form>
      </div>
    </div>
  );
}
