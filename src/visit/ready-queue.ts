type QueueEntry = { isPriority: boolean; visitId: string; readyAt?: Date | null };

export function compareReadyQueue(a: QueueEntry, b: QueueEntry) {
  if (!!a.readyAt !== !!b.readyAt) return a.readyAt ? -1 : 1;
  return (
    Number(b.isPriority) - Number(a.isPriority) ||
    (a.readyAt?.getTime() ?? 0) - (b.readyAt?.getTime() ?? 0) ||
    a.visitId.localeCompare(b.visitId)
  );
}
