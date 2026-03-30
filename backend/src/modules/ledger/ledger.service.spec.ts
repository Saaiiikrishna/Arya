import { Test, TestingModule } from '@nestjs/testing';
import { LedgerService } from './ledger.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('LedgerService', () => {
  let service: LedgerService;

  const mockTx = {
    ledgerTransaction: {
      create: jest.fn(),
    },
    project: {
      update: jest.fn(),
    },
  };

  const mockPrismaService = {
    $transaction: jest.fn((cb) => cb(mockTx)),
    ledgerTransaction: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LedgerService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<LedgerService>(LedgerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createTransaction', () => {
    it('should create a basic transaction and update project if DISBURSEMENT', async () => {
      mockTx.ledgerTransaction.create.mockResolvedValue({ id: 'l1', type: 'DISBURSEMENT', amount: 100 });
      mockTx.project.update.mockResolvedValue({ id: 'p1', fundedAmount: 100 });
      
      const result = await service.createTransaction({ projectId: 'p1', type: 'DISBURSEMENT', amount: 100, date: new Date(), description: '1' });
      expect(result.id).toEqual('l1');
      expect(mockTx.project.update).toHaveBeenCalled();
    });

    it('should not update project if UTILIZATION', async () => {
      mockTx.ledgerTransaction.create.mockResolvedValue({ id: 'l2', type: 'UTILIZATION', amount: 50 });
      
      const result = await service.createTransaction({ projectId: 'p1', type: 'UTILIZATION', amount: 50, date: new Date(), description: '2' });
      expect(result.id).toEqual('l2');
      expect(mockTx.project.update).not.toHaveBeenCalled();
    });
  });
});
