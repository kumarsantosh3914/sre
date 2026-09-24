import { createHash } from 'crypto';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Tenant, User } from '@sreai/database';
import { UserRole } from '@sreai/shared';
import * as bcrypt from 'bcrypt';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';
import { AuthService } from './auth.service';

type MockRepo<T extends { id: string }> = {
  findOne: jest.Mock<Promise<T | null>, unknown[]>;
  update: jest.Mock<Promise<unknown>, unknown[]>;
};

function createMockRepo<T extends { id: string }>(): MockRepo<T> {
  return { findOne: jest.fn(), update: jest.fn() };
}

// Mirrors AuthService's private hashRefreshToken — refresh tokens are
// hashed with SHA-256, not bcrypt (see the comment on that function for why).
function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

describe('AuthService', () => {
  let service: AuthService;
  let userRepo: MockRepo<User>;
  let tenantRepo: MockRepo<Tenant>;
  let transactionMock: jest.Mock<Promise<User>, [(manager: EntityManager) => Promise<User>]>;

  const config = new ConfigService({
    JWT_SECRET: 'test-access-secret-at-least-32-characters-long',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters-long',
  });
  const jwt = new JwtService();

  beforeEach(() => {
    userRepo = createMockRepo<User>();
    tenantRepo = createMockRepo<Tenant>();
    transactionMock = jest.fn();

    const dataSource = { transaction: transactionMock } as unknown as DataSource;

    service = new AuthService(
      userRepo as unknown as Repository<User>,
      tenantRepo as unknown as Repository<Tenant>,
      dataSource,
      jwt,
      config,
    );
  });

  describe('register', () => {
    it('throws ConflictException when the email is already registered', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1' } as User);

      await expect(
        service.register({ tenantName: 'Acme', email: 'a@acme.com', password: 'password123' }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a taken organisation name with its own message, not the email one', async () => {
      userRepo.findOne.mockResolvedValue(null);
      tenantRepo.findOne.mockResolvedValue({ id: 't0', name: 'Acme' } as Tenant);

      await expect(
        service.register({ tenantName: 'Acme', email: 'b@acme.com', password: 'password123' }),
      ).rejects.toThrow('An organisation with this name already exists');
      expect(transactionMock).not.toHaveBeenCalled();
    });

    it('maps a racing tenant-name unique violation to the organisation message', async () => {
      userRepo.findOne.mockResolvedValue(null);
      tenantRepo.findOne.mockResolvedValue(null);
      const driverError = Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'tenants_name_key',
      });
      transactionMock.mockRejectedValue(new QueryFailedError('INSERT', [], driverError));

      await expect(
        service.register({ tenantName: 'Acme', email: 'b@acme.com', password: 'password123' }),
      ).rejects.toThrow('An organisation with this name already exists');
    });

    it('creates a tenant + owner user and issues tokens', async () => {
      userRepo.findOne.mockResolvedValue(null);
      tenantRepo.findOne.mockResolvedValue(null);

      const savedUser = {
        id: 'u1',
        tenantId: 't1',
        email: 'a@acme.com',
        role: UserRole.OWNER,
        passwordHash: 'hash',
      } as User;

      transactionMock.mockImplementation(async (fn) => {
        const manager = {
          create: jest.fn((_entity: unknown, data: unknown) => data),
          save: jest.fn((entity: unknown) => {
            if (entity === Tenant) {
              return Promise.resolve({ id: 't1', name: 'Acme', slug: 'acme' } as Tenant);
            }
            return Promise.resolve(savedUser);
          }),
        } as unknown as EntityManager;
        return fn(manager);
      });

      const result = await service.register({
        tenantName: 'Acme',
        email: 'a@acme.com',
        password: 'password123',
      });

      expect(result.user).toEqual(savedUser);
      expect(result.tokens.accessToken).toEqual(expect.any(String));
      expect(result.tokens.refreshToken).toEqual(expect.any(String));
      expect(userRepo.update).toHaveBeenCalledWith('u1', {
        refreshTokenHash: expect.any(String),
      });
    });
  });

  describe('validateUser / login', () => {
    it('throws UnauthorizedException for an unknown email', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.validateUser('nope@acme.com', 'password123')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException for a wrong password', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 12);
      userRepo.findOne.mockResolvedValue({ id: 'u1', passwordHash } as User);

      await expect(service.validateUser('a@acme.com', 'wrong-password')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('issues tokens for correct credentials', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 12);
      const user = {
        id: 'u1',
        tenantId: 't1',
        email: 'a@acme.com',
        role: UserRole.MEMBER,
        passwordHash,
      } as User;
      userRepo.findOne.mockResolvedValue(user);

      const result = await service.login({ email: 'a@acme.com', password: 'correct-password' });

      expect(result.tokens.accessToken).toEqual(expect.any(String));
      expect(result.tokens.refreshToken).toEqual(expect.any(String));
    });
  });

  describe('refresh', () => {
    it('throws when the user has no stored refresh token', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1', refreshTokenHash: null } as User);

      await expect(service.refresh('u1', 'some-token')).rejects.toThrow(UnauthorizedException);
    });

    it('revokes the session and throws when the presented token does not match the stored hash', async () => {
      const storedHash = hashRefreshToken('token-a');
      userRepo.findOne.mockResolvedValue({ id: 'u1', refreshTokenHash: storedHash } as User);

      await expect(service.refresh('u1', 'token-b')).rejects.toThrow(UnauthorizedException);
      expect(userRepo.update).toHaveBeenCalledWith('u1', { refreshTokenHash: null });
    });

    it('rotates tokens when the presented token matches the stored hash', async () => {
      const currentRefreshToken = 'token-a';
      const storedHash = hashRefreshToken(currentRefreshToken);
      const user = {
        id: 'u1',
        tenantId: 't1',
        email: 'a@acme.com',
        role: UserRole.MEMBER,
        refreshTokenHash: storedHash,
      } as User;
      userRepo.findOne.mockResolvedValue(user);

      const result = await service.refresh('u1', currentRefreshToken);

      expect(result.accessToken).toEqual(expect.any(String));
      expect(result.refreshToken).not.toEqual(currentRefreshToken);
    });
  });

  describe('logout', () => {
    it('clears the stored refresh token hash', async () => {
      await service.logout('u1');

      expect(userRepo.update).toHaveBeenCalledWith('u1', { refreshTokenHash: null });
    });
  });
});
