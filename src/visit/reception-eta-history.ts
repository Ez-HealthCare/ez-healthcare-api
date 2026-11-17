import { EntityManager, In, MoreThan } from 'typeorm';
import { VN_OFFSET_MS } from '../common/constants/clinical.constants';
import { ApiConfigService } from '../config/api-config.service';
import { Role } from '../user/enums/role.enum';
import { getBusinessTime } from './business-time';
import { QueueTicket } from './entities/queue-ticket.entity';
import { ReceptionDeskShift } from './entities/reception-desk-shift.entity';
import { ReceptionEtaForecast } from './entities/reception-eta-forecast.entity';
import { QueueTicketKind, QueueTicketStatus } from './enums/queue-ticket.enum';
import { VisitStatus } from './enums/visit-status.enum';
import { estimateReceptionStarts } from './reception-eta';

const SIGNIFICANT_CHANGE_MS = 120_000;

export async function refreshReceptionEtaHistory(manager: EntityManager, config: ApiConfigService) {
  const settings = config.receptionEta;
  if (!settings) return false;
  await manager.query("SELECT pg_advisory_xact_lock(hashtext('reception-eta-history'))");
  const now = new Date();
  const { businessDate } = getBusinessTime(now, config.queueIssuanceWindows);
  const hall = await manager
    .getRepository(QueueTicket)
    .createQueryBuilder('ticket')
    .innerJoin('ticket.visit', 'visit')
    .where('ticket.kind = :kind', { kind: QueueTicketKind.HALL })
    .andWhere('ticket.business_date = :businessDate', { businessDate: businessDate })
    .andWhere('ticket.status IN (:...statuses)', {
      statuses: [QueueTicketStatus.ACTIVE, QueueTicketStatus.CALLED],
    })
    .andWhere('ticket.expires_at > :now', { now })
    .andWhere('visit.status = :visitStatus', { visitStatus: VisitStatus.HALL_WAITING })
    .orderBy(
      'CASE WHEN ticket.reissue_of_id IS NULL AND visit."isPriority" THEN 1 ELSE 0 END',
      'DESC',
    )
    .addOrderBy('ticket.queued_at', 'ASC')
    .addOrderBy('ticket.sequence', 'ASC')
    .getMany();

  const waiting = hall.filter((ticket) => ticket.status === QueueTicketStatus.ACTIVE);
  if (!waiting.length) return false;
  const estimates = await forecastWaiting(
    manager,
    config,
    settings,
    now,
    businessDate,
    hall,
    waiting.length,
  );
  const repo = manager.getRepository(ReceptionEtaForecast);
  const latest = await repo
    .createQueryBuilder('forecast')
    .distinctOn(['forecast.ticketId'])
    .where('forecast.ticketId IN (:...ids)', { ids: waiting.map((ticket) => ticket.id) })
    .orderBy('forecast.ticketId', 'ASC')
    .addOrderBy('forecast.queuedAt', 'DESC')
    .addOrderBy('forecast.version', 'DESC')
    .getMany();
  const byTicket = new Map(latest.map((row) => [row.ticketId, row]));
  const rows = waiting.flatMap((ticket, index) => {
    const latestForTicket = byTicket.get(ticket.id);
    const previous =
      latestForTicket?.queuedAt.getTime() === ticket.queuedAt.getTime()
        ? latestForTicket
        : undefined;
    const estimate = estimates[index];
    if (!previous && !estimate) return [];
    if (previous && !hasChanged(previous.estimatedStartAt, estimate, now)) return [];
    return [
      {
        ticketId: ticket.id,
        queuedAt: ticket.queuedAt,
        version: (previous?.version ?? 0) + 1,
        calculatedAt: now,
        estimatedStartAt: estimate,
      },
    ];
  });
  if (!rows.length) return false;
  await repo.insert(rows);
  return true;
}

function hasChanged(previous: Date | null, next: Date | null, now: Date) {
  if (!previous || !next) return previous !== next;
  if (previous <= now && next <= now) return false;
  return Math.abs(previous.getTime() - next.getTime()) >= SIGNIFICANT_CHANGE_MS;
}

async function forecastWaiting(
  manager: EntityManager,
  config: ApiConfigService,
  settings: NonNullable<ApiConfigService['receptionEta']>,
  now: Date,
  businessDate: string,
  hall: QueueTicket[],
  count: number,
) {
  const unavailable = Array<null>(count).fill(null);
  const localTime = new Date(now.getTime() + VN_OFFSET_MS).toISOString();
  const localClock = localTime.slice(11, 16);
  const window = config.queueIssuanceWindows.find(
    ({ start, end }) => localClock >= start && localClock < end,
  );

  if (window) {
    const [hours, minutes] = window.end.split(':').map(Number);
    const closesAt = new Date(
      Date.parse(businessDate + 'T00:00:00Z') - VN_OFFSET_MS + (hours * 60 + minutes) * 60_000,
    );
    let counterCount = settings.counterCount;
    let busySince = hall
      .filter((entry) => entry.status === QueueTicketStatus.CALLED)
      .map((entry) => entry.lastCalledAt);
    if (config.receptionDeskShiftsEnabled) {
      const { shiftType } = getBusinessTime(now, config.queueIssuanceWindows);
      if (
        !shiftType ||
        hall.some((entry) => entry.status === QueueTicketStatus.CALLED && !entry.receptionDeskCode)
      ) {
        return unavailable;
      }
      const desks = await manager.getRepository(ReceptionDeskShift).find({
        where: {
          businessDate: businessDate,
          shiftType,
          acceptingCalls: true,
          receptionist: { isActive: true, role: Role.RECEPTIONIST },
        },
      });
      counterCount = desks.length;
      const held = counterCount
        ? await manager.getRepository(QueueTicket).findBy({
            kind: QueueTicketKind.HALL,
            status: QueueTicketStatus.CALLED,
            receptionDeskCode: In(desks.map((desk) => desk.deskCode)),
            expiresAt: MoreThan(now),
          })
        : [];
      busySince = held.map((entry) => entry.verificationStartedAt ?? entry.lastCalledAt);
    }

    if (counterCount > 0) {
      return estimateReceptionStarts(
        now,
        closesAt,
        counterCount,
        settings.serviceMinutes,
        count,
        busySince,
      );
    }
  }
  return unavailable;
}
