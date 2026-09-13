import * as bcrypt from 'bcrypt';
import { AUTH_CONSTANTS } from '../../auth/constants/auth.constants';
import { ENV_KEYS } from '../../common/constants/env.constants';
import { User } from '../../user/entities/user.entity';
import { SEED_CONSTANTS } from '../constants/seed.constants';
import dataSource from '../data-source';

async function runSeed() {
  console.log('🔄 Đang khởi tạo kết nối cơ sở dữ liệu để seed dữ liệu...');
  await dataSource.initialize();

  const userRepository = dataSource.getRepository(User);

  const testEmail = process.env[ENV_KEYS.SEED_ADMIN_EMAIL] || SEED_CONSTANTS.ADMIN_EMAIL;
  const testPasswordRaw =
    process.env[ENV_KEYS.SEED_ADMIN_PASSWORD] || SEED_CONSTANTS.ADMIN_PASSWORD;
  const hashedPassword = await bcrypt.hash(testPasswordRaw, AUTH_CONSTANTS.BCRYPT_SALT_ROUNDS);

  const existingUser = await userRepository
    .createQueryBuilder('user')
    .addSelect('user.password')
    .where('user.email = :email', { email: testEmail })
    .getOne();

  if (!existingUser) {
    const newUser = userRepository.create({
      email: testEmail,
      password: hashedPassword,
      name: SEED_CONSTANTS.ADMIN_NAME,
      isActive: SEED_CONSTANTS.ADMIN_IS_ACTIVE,
    });
    await userRepository.save(newUser);
    console.log(`✅ Đã tạo tài khoản test thành công:`);
    console.log(`   - Email: ${testEmail}`);
    console.log(`   - Password: ${testPasswordRaw}`);
  } else {
    existingUser.password = hashedPassword;
    existingUser.isActive = true;
    await userRepository.save(existingUser);
    console.log(`ℹ️ Tài khoản test đã tồn tại, đã đồng bộ lại mật khẩu:`);
    console.log(`   - Email: ${testEmail}`);
    console.log(`   - Password: ${testPasswordRaw}`);
  }

  await dataSource.destroy();
  console.log('🎉 Seed dữ liệu hoàn tất!');
}

runSeed().catch((err) => {
  console.error('❌ Lỗi khi seed dữ liệu:', err);
  process.exit(1);
});
