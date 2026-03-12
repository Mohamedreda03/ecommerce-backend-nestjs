import { IS_PUBLIC_KEY } from './public.decorator';
import { PERMISSIONS_KEY } from './permissions.decorator';

describe('@Public decorator', () => {
  it('should set isPublic metadata to true on a class', () => {
    @(require('@nestjs/common').SetMetadata(IS_PUBLIC_KEY, true))
    class TestController {}

    const meta = Reflect.getMetadata(IS_PUBLIC_KEY, TestController);
    expect(meta).toBe(true);
  });

  it('should set isPublic metadata via Public() decorator', () => {
    const { Public } = require('./public.decorator');

    @Public()
    class TestController {}

    expect(Reflect.getMetadata(IS_PUBLIC_KEY, TestController)).toBe(true);
  });

  it('should not set isPublic on a class without the decorator', () => {
    class PlainController {}
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, PlainController)).toBeUndefined();
  });
});

describe('@Permissions decorator', () => {
  it('should store the provided permission strings as metadata', () => {
    const { Permissions } = require('./permissions.decorator');

    @Permissions('create:product', 'update:product')
    class TestController {}

    const meta: string[] = Reflect.getMetadata(
      PERMISSIONS_KEY,
      TestController,
    );
    expect(meta).toEqual(['create:product', 'update:product']);
  });

  it('should store a single permission correctly', () => {
    const { Permissions } = require('./permissions.decorator');

    @Permissions('read:order')
    class TestController {}

    expect(Reflect.getMetadata(PERMISSIONS_KEY, TestController)).toEqual([
      'read:order',
    ]);
  });

  it('should store an empty array when no permissions provided', () => {
    const { Permissions } = require('./permissions.decorator');

    @Permissions()
    class TestController {}

    expect(Reflect.getMetadata(PERMISSIONS_KEY, TestController)).toEqual([]);
  });
});
