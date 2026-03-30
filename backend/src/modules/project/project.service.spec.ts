import { Test, TestingModule } from '@nestjs/testing';
import { ProjectService } from './project.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

describe('ProjectService', () => {
  let service: ProjectService;

  const mockPrismaService = {
    project: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<ProjectService>(ProjectService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findByTeamId', () => {
    it('should return project if found', async () => {
      mockPrismaService.project.findUnique.mockResolvedValue({ id: 'p1', teamId: 't1' });
      const result = await service.findByTeamId('t1');
      expect(result.id).toEqual('p1');
    });

    it('should throw if not found', async () => {
      mockPrismaService.project.findUnique.mockResolvedValue(null);
      await expect(service.findByTeamId('t1')).rejects.toThrow(NotFoundException);
    });
  });
});
