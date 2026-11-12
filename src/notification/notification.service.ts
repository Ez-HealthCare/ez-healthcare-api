import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Notification } from './notification.entity';
import type { NotificationPageQueryDto } from './dto/notification-page-query.dto';

@Injectable()
export class NotificationService {
  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
  ) {}

  create(
    data: Pick<Notification, 'userId' | 'type' | 'title' | 'message'> &
      Partial<Pick<Notification, 'visitId' | 'metadata'>>,
    manager?: EntityManager,
  ) {
    const repo = manager ? manager.getRepository(Notification) : this.notifications;
    return repo.save(repo.create(data));
  }

  list(userId: string) {
    return this.notifications.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  async page(userId: string, { limit, filter, cursor }: NotificationPageQueryDto) {
    const query = this.notifications
      .createQueryBuilder('notification')
      .where('notification.user_id = :userId', { userId });
    if (filter === 'unread') query.andWhere('notification.read_at IS NULL');
    if (filter === 'read') query.andWhere('notification.read_at IS NOT NULL');
    if (cursor) {
      // Read the anchor timestamp in PostgreSQL, preserving microsecond precision.
      // The anchor is scoped to the same user even when it has since been read.
      query.andWhere(
        `(notification.created_at, notification.id) < (
        SELECT anchor.created_at, anchor.id FROM notifications anchor
        WHERE anchor.id = :cursor AND anchor.user_id = :userId
      )`,
        { cursor },
      );
    }
    const [rows, counts] = await Promise.all([
      query
        .orderBy('notification.created_at', 'DESC')
        .addOrderBy('notification.id', 'DESC')
        .take(limit + 1)
        .getMany(),
      this.notifications
        .createQueryBuilder('notification')
        .select('COUNT(*)', 'total')
        .addSelect('COUNT(*) FILTER (WHERE notification.read_at IS NULL)', 'unread')
        .where('notification.user_id = :userId', { userId })
        .getRawOne<{ total: string; unread: string }>(),
    ]);
    const items = rows.slice(0, limit);
    return {
      items,
      nextCursor: rows.length > limit ? items[items.length - 1].id : null,
      total: Number(counts?.total || 0),
      unreadCount: Number(counts?.unread || 0),
    };
  }

  async markRead(id: string, userId: string) {
    const notification = await this.notifications.findOne({ where: { id, userId } });
    if (!notification) throw new NotFoundException('Notification not found');
    notification.readAt ??= new Date();
    return this.notifications.save(notification);
  }

  async markAllRead(userId: string) {
    await this.notifications
      .createQueryBuilder()
      .update(Notification)
      .set({ readAt: new Date() })
      .where('user_id = :userId AND read_at IS NULL', { userId })
      .execute();
    return { success: true };
  }
}
