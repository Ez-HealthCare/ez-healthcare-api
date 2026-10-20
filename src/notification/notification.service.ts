import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Notification } from './notification.entity';

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
