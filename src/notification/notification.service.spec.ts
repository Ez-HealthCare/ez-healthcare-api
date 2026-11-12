import 'reflect-metadata';
import { jest } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Repository } from 'typeorm';
import { Notification } from './notification.entity';
import { NotificationService } from './notification.service';
import { NotificationPageQueryDto } from './dto/notification-page-query.dto';

function setup(length = 11) {
  const rows = Array.from({ length }, (_, index) => ({
    id: String(index),
    title: 'fixture',
  })) as Notification[];
  const page = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: async () => rows,
  };
  const counts = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getRawOne: async () => ({ total: '75', unread: '52' }),
  };
  const repo = {
    createQueryBuilder: jest.fn().mockReturnValueOnce(page).mockReturnValueOnce(counts),
  };
  return {
    service: new NotificationService(repo as unknown as Repository<Notification>),
    page,
    counts,
  };
}

describe('notification cursor pages', () => {
  it('bounds one page, reports global user counts, and returns the last displayed cursor', async () => {
    const { service, page, counts } = setup();
    const result = await service.page('patient-a', new NotificationPageQueryDto());
    expect(result.items).toHaveLength(10);
    expect(result.nextCursor).toBe('9');
    expect(result.total).toBe(75);
    expect(result.unreadCount).toBe(52);
    expect(page.take).toHaveBeenCalledWith(11);
    expect(page.where).toHaveBeenCalledWith('notification.user_id = :userId', {
      userId: 'patient-a',
    });
    expect(counts.where).toHaveBeenCalledWith('notification.user_id = :userId', {
      userId: 'patient-a',
    });
    expect(page.orderBy).toHaveBeenCalledWith('notification.created_at', 'DESC');
    expect(page.addOrderBy).toHaveBeenCalledWith('notification.id', 'DESC');
  });

  it.each(['read', 'unread'] as const)(
    'filters %s on the server and scopes the cursor anchor to the owner',
    async (filter) => {
      const { service, page } = setup(5);
      const cursor = '11111111-1111-4111-8111-111111111111';
      const result = await service.page('patient-b', { limit: 10, filter, cursor });
      expect(result.nextCursor).toBeNull();
      expect(page.andWhere).toHaveBeenCalledWith(
        filter === 'read' ? 'notification.read_at IS NOT NULL' : 'notification.read_at IS NULL',
      );
      expect(page.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('anchor.user_id = :userId'),
        { cursor },
      );
      // The timestamp comes from the DB anchor; converting Date to ISO would lose microseconds.
      expect(page.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('SELECT anchor.created_at, anchor.id'),
        { cursor },
      );
    },
  );

  it('terminates an empty page without a cursor', async () => {
    const { service } = setup(0);
    const result = await service.page('patient-a', { limit: 10, filter: 'all' });
    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  it.each([
    { limit: 0 },
    { limit: 31 },
    { limit: 'abc' },
    { filter: 'other' },
    { cursor: "' OR true" },
  ])('rejects invalid query input %j', async (input) => {
    expect(
      (await validate(plainToInstance(NotificationPageQueryDto, input))).length,
    ).toBeGreaterThan(0);
  });

  it('transforms a valid limit and retains defaults', async () => {
    const dto = plainToInstance(NotificationPageQueryDto, { limit: '3' });
    expect(await validate(dto)).toEqual([]);
    expect(dto.limit).toBe(3);
    expect(dto.filter).toBe('all');
  });
});
