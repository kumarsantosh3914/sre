import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Tenant, User } from '@sreai/database';
import { JwtAccessPayload, UserRole } from '@sreai/shared';
import * as bcrypt from 'bcrypt';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { slugify } from './util/slugify';

const BCRYPT_ROUNDS = 12;
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '7d';
const POSTGRES_UNIQUE_VIOLATION = '23505';
// tenants.name is UNIQUE (InitSchema); users.email is UNIQUE.
const TENANT_NAME_CONSTRAINT = 'tenants_name_key';
const EMAIL_TAKEN = 'Email already registered';
const TENANT_NAME_TAKEN = 'An organisation with this name already exists';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

// Refresh tokens are stored hashed, but NOT with bcrypt: bcrypt only
// consumes the first 72 bytes of its input, and a JWT's shared header plus
// identical leading `sub` claim between two tokens for the same user means
// the byte that actually differs (e.g. `jti`) can fall past that cutoff —
// bcrypt would then treat two genuinely different tokens as equal, which
// silently breaks rotation invalidation. Refresh tokens are already
// high-entropy (unlike user passwords), so a fast digest + constant-time
// compare is both correct and the right tool here; bcrypt stays reserved
// for the actual (short, low-entropy) user password below.
function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function refreshTokenMatches(presented: string, storedHash: string): boolean {
  const presentedHash = Buffer.from(hashRefreshToken(presented), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return presentedHash.length === stored.length && timingSafeEqual(presentedHash, stored);
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    private readonly dataSource: DataSource,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<{ user: User; tokens: AuthTokens }> {
    const existing = await this.userRepo.findOne({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException(EMAIL_TAKEN);
    }
    const nameTaken = await this.tenantRepo.findOne({ where: { name: dto.tenantName } });
    if (nameTaken) {
      throw new ConflictException(TENANT_NAME_TAKEN);
    }

    const slug = await this.uniqueSlug(dto.tenantName);
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    let user: User;
    try {
      user = await this.dataSource.transaction(async (manager) => {
        const tenant = await manager.save(
          Tenant,
          manager.create(Tenant, { name: dto.tenantName, slug }),
        );
        return manager.save(
          User,
          manager.create(User, {
            tenantId: tenant.id,
            email: dto.email,
            passwordHash,
            role: UserRole.OWNER,
          }),
        );
      });
    } catch (err) {
      // The findOne checks above race: two concurrent registrations can
      // both pass them before either commits. Catch the DB's own unique
      // constraints here rather than 500ing, and name the one that fired.
      const driverError =
        err instanceof QueryFailedError
          ? (err.driverError as { code?: string; constraint?: string } | undefined)
          : undefined;
      if (driverError?.code === POSTGRES_UNIQUE_VIOLATION) {
        throw new ConflictException(
          driverError.constraint === TENANT_NAME_CONSTRAINT ? TENANT_NAME_TAKEN : EMAIL_TAKEN,
        );
      }
      throw err;
    }

    this.logger.log('Tenant + owner user registered', {
      tenantId: user.tenantId,
      userId: user.id,
    });

    const tokens = await this.issueTokens(user);
    return { user, tokens };
  }

  // The one lookup in this codebase allowed to not be tenant-scoped. This
  // is a deliberate exception to CLAUDE.md's tenant-scoping rule, not an
  // oversight: login is what resolves tenantId in the first place, so it
  // can't be known ahead of the query. Email is globally unique (see the
  // User entity) precisely so this lookup is still well-defined and safe —
  // it returns at most one account, not a tenant-scoped listing that could
  // leak another tenant's rows.
  async validateUser(email: string, password: string): Promise<User> {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      this.logger.warn('Login failed: invalid credentials', { email });
      throw new UnauthorizedException('Invalid credentials');
    }
    return user;
  }

  async login(dto: LoginDto): Promise<{ user: User; tokens: AuthTokens }> {
    const user = await this.validateUser(dto.email, dto.password);
    const tokens = await this.issueTokens(user);
    this.logger.log('User logged in', { tenantId: user.tenantId, userId: user.id });
    return { user, tokens };
  }

  async refresh(userId: string, presentedRefreshToken: string): Promise<AuthTokens> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user?.refreshTokenHash) {
      this.logger.warn('Refresh rejected: no stored refresh token', { userId });
      throw new UnauthorizedException('Invalid refresh token');
    }

    const matches = refreshTokenMatches(presentedRefreshToken, user.refreshTokenHash);
    if (!matches) {
      // Presented token doesn't match what we last issued — possible reuse
      // of a stale/stolen token. Revoke so the legitimate session (which
      // rotated past this token) still works, but this one can't retry.
      this.logger.warn('Refresh token reuse detected — revoking session', {
        tenantId: user.tenantId,
        userId: user.id,
      });
      await this.userRepo.update(user.id, { refreshTokenHash: null });
      throw new UnauthorizedException('Invalid refresh token');
    }

    return this.issueTokens(user);
  }

  async logout(userId: string): Promise<void> {
    await this.userRepo.update(userId, { refreshTokenHash: null });
    this.logger.log('User logged out', { userId });
  }

  private async issueTokens(user: User): Promise<AuthTokens> {
    const payload: JwtAccessPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
    };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get<string>('JWT_SECRET'),
      expiresIn: ACCESS_TOKEN_TTL,
    });
    const refreshToken = await this.jwt.signAsync(
      // jti makes every issued refresh token unique even within the same
      // second — without it, two tokens signed in the same wall-clock
      // second (e.g. back-to-back refresh calls) are byte-identical, since
      // JWT signing is deterministic given identical header+payload+secret.
      // That would silently defeat rotation: the "old" token would still
      // validate against the "new" stored hash because they're the same string.
      { sub: user.id, jti: randomUUID() },
      { secret: this.config.get<string>('JWT_REFRESH_SECRET'), expiresIn: REFRESH_TOKEN_TTL },
    );

    const refreshTokenHash = hashRefreshToken(refreshToken);
    await this.userRepo.update(user.id, { refreshTokenHash });

    return { accessToken, refreshToken };
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base = slugify(name);
    let candidate = base;
    let suffix = 1;
    while (await this.tenantRepo.findOne({ where: { slug: candidate } })) {
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }
    return candidate;
  }
}
