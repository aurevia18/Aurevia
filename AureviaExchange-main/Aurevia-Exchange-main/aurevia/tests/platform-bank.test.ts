import {BankOperationDirection,BankOperationStatus,BankOperationType,EntryType,Prisma,UserStatus} from '@prisma/client';
import {describe,expect,it,vi} from 'vitest';
import {createBankOperationRequest,getTreasuryAvailable,reviewBankOperation} from '@/lib/platform-bank';

describe('internal platform bank ledger controls',()=>{
	it('calculates treasury funds using debit-normal accounting',async()=>{
		const tx={
			ledgerAccount:{
				upsert:vi.fn().mockResolvedValue({id:'treasury'}),
				findUniqueOrThrow:vi.fn().mockResolvedValue({startingBalance:new Prisma.Decimal('10.00'),currency:'USD'}),
			},
			ledgerEntry:{groupBy:vi.fn().mockResolvedValue([
				{type:EntryType.DEBIT,_sum:{amount:new Prisma.Decimal('100.00')}},
				{type:EntryType.CREDIT,_sum:{amount:new Prisma.Decimal('25.00')}},
			])},
		} as unknown as Prisma.TransactionClient;

		await expect(getTreasuryAvailable(tx,'USD')).resolves.toEqual(new Prisma.Decimal('85.00'));
	});

	it('prevents an administrator from approving their own operation',async()=>{
		const tx={
			user:{findUnique:vi.fn().mockResolvedValue({role:'ADMIN',status:UserStatus.ACTIVE})},
			bankOperation:{findUnique:vi.fn().mockResolvedValue({
				id:'operation-1',
				status:BankOperationStatus.PENDING,
				initiatedById:'admin-1',
			})},
			ledgerTransaction:{create:vi.fn()},
		} as unknown as Prisma.TransactionClient;

		await expect(reviewBankOperation(tx,'operation-1','admin-1','APPROVE')).rejects.toThrow('DISTINCT_ADMIN_REQUIRED');
		expect(tx.ledgerTransaction.create).not.toHaveBeenCalled();
	});

	it('replays an identical operation request but rejects key reuse with changed details',async()=>{
		const existing={
			id:'operation-1',
			type:BankOperationType.TREASURY_ADJUSTMENT,
			direction:BankOperationDirection.INCREASE,
			userId:null,
			amount:new Prisma.Decimal('20.00'),
			currency:'USD',
			sourceClassification:'INTERNAL_ADJUSTMENT',
			reason:'Approved internal accounting adjustment',
			initiatedById:'admin-1',
			status:BankOperationStatus.PENDING,
		};
		const tx={
			user:{findUnique:vi.fn().mockResolvedValue({role:'ADMIN',status:UserStatus.ACTIVE})},
			bankOperation:{findUnique:vi.fn().mockResolvedValue(existing),create:vi.fn()},
		} as unknown as Prisma.TransactionClient;
		const request={
			type:BankOperationType.TREASURY_ADJUSTMENT,
			direction:BankOperationDirection.INCREASE,
			amount:'20.00',
			currency:'usd',
			sourceClassification:'internal_adjustment',
			reason:'Approved internal accounting adjustment',
			idempotencyKey:'request-key',
			initiatedById:'admin-1',
		};

		await expect(createBankOperationRequest(tx,request)).resolves.toEqual({operation:existing,replayed:true});
		await expect(createBankOperationRequest(tx,{...request,amount:'21.00'})).rejects.toThrow('IDEMPOTENCY_KEY_REUSED');
		expect(tx.bankOperation.create).not.toHaveBeenCalled();
	});

	it('requires the adjustment direction only for treasury adjustments',async()=>{
		const tx={
			user:{findUnique:vi.fn().mockResolvedValue({role:'ADMIN',status:UserStatus.ACTIVE})},
			bankOperation:{findUnique:vi.fn()},
		} as unknown as Prisma.TransactionClient;

		await expect(createBankOperationRequest(tx,{
			type:BankOperationType.TREASURY_FUNDING,
			direction:BankOperationDirection.INCREASE,
			amount:'20.00',
			currency:'USD',
			sourceClassification:'AUTHORIZED_CAPITAL',
			reason:'Authorized internal capital entry',
			idempotencyKey:'funding-key',
			initiatedById:'admin-1',
		})).rejects.toThrow('INVALID_OPERATION_DIRECTION');
	});
});
