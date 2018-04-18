# ali-oss-based storage adapter for KeystoneJS

## Usage

Configure the storage adapter:

```js
var storage = new keystone.Storage({
  adapter: require("keystone-storage-adapter-ali-oss"),
  oss: {
    endponit: "oss-cn-shanghai.aliyuncs.com", // required;
    accessKeyId: "key", // required; defaults to process.env.OSS_KEY
    accessKeySecret: "secret", // required; defaults to process.env.OSS_SECRET
    bucket: "mybucket", // required; defaults to process.env.OSS_BUCKET
    path: "/profilepics",
    headers: {
      "x-amz-acl": "public-read" // add default headers; see below for details
    }
  },
  schema: {
    bucket: true, // optional; store the bucket the file was uploaded to in your db
    etag: true, // optional; store the etag for the resource
    path: true, // optional; store the path of the file in your db
    url: true // optional; generate & store a public URL
  }
});
```

Then use it as the storage provider for a File field:

```js
File.add({
  name: { type: String },
  file: { type: Types.File, storage: storage }
});
```

### Options:

The adapter requires an additional `ali-oss` field added to the storage options. It accepts the following values:

* **accessKeyId**: _(required)_ Ali-oss access key. Configure your Aliyun credentials in the [IAM console](https://console.Aliyun.amazon.com/iam/home?region=ap-southeast-2#home).

* **accessKeySecret**: _(required)_ Ali-oss access secret.

* **bucket**: _(required)_ ali-oss bucket to upload files to. Bucket must be created before it can be used.

* **region**: Aliyun region to connect to. Aliyun buckets are global, but local regions will let you upload and download files faster. Defaults to `'oss-cn-hangzhou'`. Eg, `'oss-cn-hangzhou'`.

* **path**: Storage path inside the bucket. By default uploaded files will be stored in the root of the bucket. You can override this by specifying a base path here. Base path must be absolute, for example '/images/profilepics'.

* **headers**: Default headers to add when uploading files to ali-oss. You can use these headers to configure lots of additional properties and store (small) extra data about the files in ali-oss itself.

### Schema

The adapter supports all the standard Keystone file schema fields. It also supports storing the following values per-file:

* **bucket**, **path**: The bucket, and path within the bucket, for the file can be is stored in the database. If these are present when reading or deleting files, they will be used instead of looking at the adapter configuration. The effect of this is that you can have some (eg, old) files in your collection stored in different bucket / different path inside your bucket.

The main use of this is to allow slow data migrations. If you _don't_ store these values you can arguably migrate your data more easily - just move it all, then reconfigure and restart your server.

* **etag**: The etag of the stored item. This is equal to the MD5 sum of the file content.

# License

Licensed under the standard MIT license. See [LICENSE](license).
