import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';

export interface AuditLogEntry {
  action: string;
  actorId?: string | null;
  actorRole?: string | null;
  targetEntityType: string;
  targetEntityId: string;
  metadata?: Record<string, any> | null;
  ipAddress?: string | null;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
  ) {}

  async log(entry: AuditLogEntry, manager?: EntityManager): Promise<AuditLog> {
    const repo = manager ? manager.getRepository(AuditLog) : this.auditLogRepository;
    const auditLog = repo.create({
      action: entry.action,
      actorId: entry.actorId ?? null,
      actorRole: entry.actorRole ?? null,
      targetEntityType: entry.targetEntityType,
      targetEntityId: entry.targetEntityId,
      metadata: entry.metadata ?? null,
      ipAddress: entry.ipAddress ?? null,
    });
    return await repo.save(auditLog);
  }

  async getByTarget(type: string, id: string): Promise<AuditLog[]> {
    return await this.auditLogRepository.find({
      where: {
        targetEntityType: type,
        targetEntityId: id,
      },
      order: {
        createdAt: 'DESC',
      },
    });
  }

  async getByActor(id: string): Promise<AuditLog[]> {
    return await this.auditLogRepository.find({
      where: {
        actorId: id,
      },
      order: {
        createdAt: 'DESC',
      },
    });
  }
}
