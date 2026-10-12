import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { jest } from '@jest/globals';

// Graph types for Kahn DAG Specification
export interface DagEdge {
  from: string;
  to: string;
  type: string;
  reason: string;
}

export function runKahnAlgorithm(
  vertices: string[],
  edges: DagEdge[],
): { isAcyclic: boolean; sortedOrder?: string[]; error?: string } {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  vertices.forEach((v) => {
    inDegree.set(v, 0);
    adjacency.set(v, []);
  });

  edges.forEach((e) => {
    if (inDegree.has(e.to)) {
      inDegree.set(e.to, inDegree.get(e.to)! + 1);
    }
    if (adjacency.has(e.from)) {
      adjacency.get(e.from)!.push(e.to);
    }
  });

  const queue: string[] = [];
  inDegree.forEach((degree, vertex) => {
    if (degree === 0) queue.push(vertex);
  });

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);

    const neighbors = adjacency.get(current) || [];
    for (const neighbor of neighbors) {
      inDegree.set(neighbor, inDegree.get(neighbor)! - 1);
      if (inDegree.get(neighbor) === 0) {
        queue.push(neighbor);
      }
    }
  }

  if (sorted.length !== vertices.length) {
    return {
      isAcyclic: false,
      error:
        'Cyclic dependency detected in clinical orders. Order graph must be directed and acyclic.',
    };
  }

  return {
    isAcyclic: true,
    sortedOrder: sorted,
  };
}

export class MockTriageDagService {
  constructor(
    private readonly visitRepo: any,
    private readonly ruleRepo: any,
  ) {}

  async processClinicalOrders(
    visitId: string,
    physicianId: string,
    dto: { orders: string[]; symptoms?: string[]; pregnancySuspected?: boolean },
  ) {
    const visit = await this.visitRepo.findOne({ where: { id: visitId } });
    if (!visit) {
      throw new BadRequestException('Visit not found');
    }

    if (!visit.vitalsRecorded) {
      throw new BadRequestException(
        'Mandatory vital signs must be recorded before clinical orders can be submitted.',
      );
    }

    // 1. STAT Emergency Protocol Intercept
    const redFlagRules = ['SYM_CHEST_PAIN_STAT', 'SYM_SEVERE_HYPOXIA'];
    const hasRedFlag = (dto.symptoms || []).some((s) => redFlagRules.includes(s));
    if (hasRedFlag) {
      return {
        isStatEmergency: true,
        destinationRoom: 'P.001',
        alert: '🚨 STAT EMERGENCY PROTOCOL ACTIVATED: Immediate transfer to P.001 Emergency Unit!',
      };
    }

    // 2. Radiation Safety Intercept
    if (dto.pregnancySuspected && dto.orders.includes('P.302')) {
      throw new UnprocessableEntityException(
        'RADIATION HAZARD: Chest X-Ray P.302 is contraindicated for pregnant patients. Please substitute with Ultrasound or MRI.',
      );
    }

    // 3. Build Graph Vertices & Medical Edges
    const clinicCode = 'P.102';
    const cleanOrders = Array.from(new Set(dto.orders.filter((c) => c !== clinicCode)));
    const vertices = [...cleanOrders, clinicCode];
    const edges: DagEdge[] = [];

    // All paraclinical must conclude at the physician clinic
    for (const o of cleanOrders) {
      edges.push({
        from: o,
        to: clinicCode,
        type: 'CONCLUSION_DEPENDENCY',
        reason: 'Diagnostic test must conclude at doctor consultation clinic',
      });
    }

    // Physiological constraint: Ultrasound P.104 before Urinalysis P.203
    if (cleanOrders.includes('P.104') && cleanOrders.includes('P.203')) {
      edges.push({
        from: 'P.104',
        to: 'P.203',
        type: 'PHYSIOLOGICAL_PREREQUISITE',
        reason: 'Abdominal ultrasound requires full bladder before urinalysis',
      });
    }

    // 4. Cycle Detection
    const result = runKahnAlgorithm(vertices, edges);
    if (!result.isAcyclic) {
      throw new BadRequestException(result.error);
    }

    return {
      isStatEmergency: false,
      isAcyclic: true,
      sortedOrder: result.sortedOrder,
      edges,
    };
  }
}

describe('TriageDagService (Specification: Kahn DAG & Medical Safety Rules)', () => {
  let service: MockTriageDagService;
  let mockVisitRepo: any;
  let mockRuleRepo: any;

  beforeEach(() => {
    mockVisitRepo = {
      findOne: jest.fn(),
    };
    mockRuleRepo = {
      find: jest.fn(),
    };
    service = new MockTriageDagService(mockVisitRepo, mockRuleRepo);
  });

  describe('Happy Path Scenarios', () => {
    it('should generate topological order where Ultrasound (P.104) strictly precedes Urinalysis (P.203)', async () => {
      mockVisitRepo.findOne.mockResolvedValue({
        id: 'visit-1',
        vitalsRecorded: true,
      });

      const result = await service.processClinicalOrders('visit-1', 'doc-1', {
        orders: ['P.203', 'P.104', 'P.201'], // Blood test, Urinalysis, Ultrasound
        pregnancySuspected: false,
      });

      expect(result.isAcyclic).toBe(true);
      const sorted = result.sortedOrder!;
      const ultrasoundIndex = sorted.indexOf('P.104');
      const urinalysisIndex = sorted.indexOf('P.203');
      const clinicIndex = sorted.indexOf('P.102');

      // Ultrasound MUST be before Urinalysis
      expect(ultrasoundIndex).toBeLessThan(urinalysisIndex);
      // All tests MUST precede final consultation clinic P.102
      expect(urinalysisIndex).toBeLessThan(clinicIndex);
      expect(sorted.indexOf('P.201')).toBeLessThan(clinicIndex);
    });

    it('should correctly process single diagnostic test order', async () => {
      mockVisitRepo.findOne.mockResolvedValue({
        id: 'visit-1',
        vitalsRecorded: true,
      });

      const result = await service.processClinicalOrders('visit-1', 'doc-1', {
        orders: ['P.201'], // Only blood test
        pregnancySuspected: false,
      });

      expect(result.isAcyclic).toBe(true);
      expect(result.sortedOrder).toEqual(['P.201', 'P.102']);
    });
  });

  describe('Unhappy Path & Safety Intercept Scenarios', () => {
    it('should throw BadRequestException if vital signs have not been recorded yet', async () => {
      mockVisitRepo.findOne.mockResolvedValue({
        id: 'visit-1',
        vitalsRecorded: false, // Missing vitals
      });

      await expect(
        service.processClinicalOrders('visit-1', 'doc-1', { orders: ['P.104'] }),
      ).rejects.toThrow(
        new BadRequestException(
          'Mandatory vital signs must be recorded before clinical orders can be submitted.',
        ),
      );
    });

    it('should throw UnprocessableEntityException when Chest X-Ray (P.302) is ordered for a suspected pregnant patient', async () => {
      mockVisitRepo.findOne.mockResolvedValue({
        id: 'visit-1',
        vitalsRecorded: true,
      });

      await expect(
        service.processClinicalOrders('visit-1', 'doc-1', {
          orders: ['P.302', 'P.201'],
          pregnancySuspected: true, // Radiation hazard trigger
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should trigger STAT Emergency protocol when Red Flag symptom is present in order submission', async () => {
      mockVisitRepo.findOne.mockResolvedValue({
        id: 'visit-1',
        vitalsRecorded: true,
      });

      const result = await service.processClinicalOrders('visit-1', 'doc-1', {
        orders: ['P.201'],
        symptoms: ['SYM_CHEST_PAIN_STAT'], // Red Flag: acute chest pain
      });

      expect(result.isStatEmergency).toBe(true);
      expect(result.destinationRoom).toBe('P.001');
      expect(result.alert).toContain('STAT EMERGENCY PROTOCOL ACTIVATED');
    });

    it('should reject cyclic dependency using Kahn algorithm detection', () => {
      const vertices = ['A', 'B', 'C'];
      const cyclicEdges: DagEdge[] = [
        { from: 'A', to: 'B', type: 'DEP', reason: '' },
        { from: 'B', to: 'C', type: 'DEP', reason: '' },
        { from: 'C', to: 'A', type: 'DEP', reason: '' }, // Cycle: A -> B -> C -> A
      ];

      const result = runKahnAlgorithm(vertices, cyclicEdges);
      expect(result.isAcyclic).toBe(false);
      expect(result.error).toContain('Cyclic dependency detected');
    });
  });
});
