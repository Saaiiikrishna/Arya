import { Test, TestingModule } from '@nestjs/testing';
import { SprintService } from './sprint.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

describe('SprintService', () => {
  let service: SprintService;

  const mockPrismaService = {
    sprint: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    milestone: {
      create: jest.fn(),
      createMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SprintService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<SprintService>(SprintService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createSprint', () => {
    it('should create a sprint', async () => {
      // DTO date fields are ISO strings (@IsDateString).
      const dto = { teamId: 't1', title: 'Sprint 1', startDate: '2026-07-01T00:00:00.000Z', endDate: '2026-07-15T00:00:00.000Z' };
      mockPrismaService.sprint.create.mockResolvedValue({ id: 's1', ...dto });
      const result = await service.createSprint(dto);
      expect(result.id).toEqual('s1');
      expect(mockPrismaService.sprint.create).toHaveBeenCalled();
    });
  });

  describe('getSprintByTeamId', () => {
    // Call as admin so the ownership check takes the admin-bypass branch.
    it('should return a sprint if found', async () => {
      mockPrismaService.sprint.findFirst.mockResolvedValue({ id: 's1', teamId: 't1' });
      const result = await service.getSprintByTeamId('t1', 'admin-1', 'ADMIN');
      expect(result.id).toEqual('s1');
    });

    it('should throw NotFoundException if not found', async () => {
      mockPrismaService.sprint.findFirst.mockResolvedValue(null);
      await expect(service.getSprintByTeamId('t1', 'admin-1', 'ADMIN')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createMilestone', () => {
    it('should throw if sprint not found', async () => {
      mockPrismaService.sprint.findUnique.mockResolvedValue(null);
      await expect(service.createMilestone('s1', { title: 'M1', type: 'CUSTOM', deadline: '2026-07-10T00:00:00.000Z' })).rejects.toThrow(NotFoundException);
    });

    it('should create milestone', async () => {
      mockPrismaService.sprint.findUnique.mockResolvedValue({ id: 's1' });
      mockPrismaService.milestone.create.mockResolvedValue({ id: 'm1' });
      const result = await service.createMilestone('s1', { title: 'M1', type: 'CUSTOM', deadline: '2026-07-10T00:00:00.000Z' });
      expect(result.id).toEqual('m1');
    });
  });
});
