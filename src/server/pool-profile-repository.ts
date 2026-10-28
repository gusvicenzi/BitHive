import { Prisma, type PrismaClient } from '@prisma/client';
import { poolProfileSchema, type PoolProfile } from '../shared/pool-profiles.js';
import { AppError } from './errors.js';

export class PoolProfileRepository {
  constructor(private db: PrismaClient) {}
  async list(): Promise<PoolProfile[]> {
    return (await this.db.poolProfile.findMany({ orderBy: { createdAt: 'asc' }, take: 100 }))
      .map(p => ({ id: p.id, ...poolProfileSchema.parse({ name: p.name, settings: JSON.parse(p.settings) }) }));
  }
  async save(input: unknown, id?: string) {
    const body = poolProfileSchema.parse(input);
    try {
      const profile = await this.db.$transaction(async tx => {
        if (id && !await tx.poolProfile.findUnique({ where: { id } })) throw new AppError('notFound', 404);
        if (!id && await tx.poolProfile.count() >= 100) throw new AppError('poolProfileLimit');
        const data = { name: body.name, settings: JSON.stringify(body.settings) };
        return id ? tx.poolProfile.update({ where: { id }, data }) : tx.poolProfile.create({ data });
      });
      return { id: profile.id, ...body };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new AppError('duplicatePoolProfile', 409);
      throw error;
    }
  }
  async remove(id: string) {
    const result = await this.db.poolProfile.deleteMany({ where: { id } });
    if (!result.count) throw new AppError('notFound', 404);
    return { deleted: true };
  }
}
