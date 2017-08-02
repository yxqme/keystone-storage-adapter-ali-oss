/*
TODO
- Check whether files exist before uploading (will always overwrite as-is)
- Support multiple retry attempts if a file exists (see FS Adapter)
*/

// Mirroring keystone 0.4's support of node 0.12.
var co = require('co');
var assign = require('object-assign');
var debug = require('debug')('keystone-ali-oss');
var ensureCallback = require('keystone-storage-namefunctions/ensureCallback');
var oss = require('ali-oss');
var nameFunctions = require('keystone-storage-namefunctions');
var pathlib = require('path');

var DEFAULT_OPTIONS = {
	accessKeyId: process.env.OSS_KEY,
	accessKeySecret: process.env.OSS_SECRET,
	bucket: process.env.OSS_BUCKET,
	region: process.env.OSS_REGION || 'oss-cn-hangzhou',
	generateFilename: nameFunctions.randomFilename,
};

// This constructor is usually called indirectly by the Storage class
// in keystone.

// S3-specific options should be specified in an `options.s3` field,
// which can contain the following options: { key, secret, bucket, region,
// headers, path }.

// The schema can contain the additional fields { path, bucket, etag }.

// See README.md for details and usage examples.

function AliOssAdapter (options, schema) {
	this.options = assign({}, DEFAULT_OPTIONS, options.oss);

	// Support `defaultHeaders` option alias for `headers`
	// TODO: Remove me with the next major version bump
	if (this.options.defaultHeaders) {
		this.options.headers = this.options.defaultHeaders;
	}

	// Knox will check for the 'key', 'secret' and 'bucket' options.
	this.client = oss(this.options);

	// If path is specified it must be absolute.
	if (options.path != null && !pathlib.isAbsolute(options.path)) {
		throw Error('Configuration error: ali-oss path must be absolute');
	}

	// Ensure the generateFilename option takes a callback
	this.options.generateFilename = ensureCallback(this.options.generateFilename);
}

AliOssAdapter.compatibilityLevel = 1;

// All the extra schema fields supported by this adapter.
AliOssAdapter.SCHEMA_TYPES = {
	filename: String,
	bucket: String,
	path: String,
	etag: String,
};

AliOssAdapter.SCHEMA_FIELD_DEFAULTS = {
	filename: true,
	bucket: false,
	path: false,
	etag: false,
};

// Return a knox client configured to interact with the specified file.
AliOssAdapter.prototype._ossForFile = function (file) {
	// Clients are allowed to store the bucket name in the file structure. If they
	// do it'll make it possible to have some files in one bucket and some files
	// in another bucket. The knox client is configured per-bucket, so if you're
	// using multiple buckets we'll need a different knox client for each file.
	if (file.bucket && file.bucket !== this.options.bucket) {
		var options = assign({}, this.options, { bucket: file.bucket });
		return oss(options);
	} else {
		return this.client;
	}
};

// Get the full, absolute path name for the specified file.
AliOssAdapter.prototype._resolveFilename = function (file) {
	// Just like the bucket, the schema can store the path for files. If the path
	// isn't stored we'll assume all the files are in the path specified in the
	// s3.path option. If that doesn't exist we'll assume the file is in the root
	// of the bucket. (Whew!)
	var path = file.path || this.options.path || '/';
	return pathlib.posix.resolve(path, file.filename);
};

AliOssAdapter.prototype.uploadFile = function (file, callback) {
	var self = this;
	this.options.generateFilename(file, 0, function (err, filename) {
		if (err) return callback(err);

		// The expanded path of the file on the filesystem.
		var localpath = file.path;

		// The destination path inside the S3 bucket.
		file.path = self.options.path;
		file.filename = filename;
		var destpath = self._resolveFilename(file);

		// Figure out headers
		var headers = assign({}, self.options.headers, {
			'Content-Length': file.size,
			'Content-Type': file.mimetype,
		});

		debug('Uploading file %s', filename);
		co(function * () {
			var { res } = yield self.client.put(destpath, localpath, { headers });
			if (res.statusCode !== 200) {
				return callback(new Error('Aliyun returned status code: ' + res.statusCode));
			}
			file.filename = filename;
			file.etag = res.headers.etag;
			file.path = self.options.path;
			file.bucket = self.options.bucket;

			debug('file upload successful');
			callback(null, file);
		}).catch(err => callback(err));
	});
};

// Note that this will provide a public URL for the file, but it will only
// work if:
// - the bucket is public (best) or
// - the file is set to a canned ACL (ie, headers:{ 'x-amz-acl': 'public-read' } )
// - you pass credentials during your request for the file content itself
AliOssAdapter.prototype.getFileURL = function (file) {
	// Consider providing an option to use insecure http. I can't think of any
	// sensible use case for plain http though. https should be used everywhere.
	return this._ossForFile(file).getObjectUrl(this._resolveFilename(file));
};

AliOssAdapter.prototype.removeFile = function (file, callback) {
	var fullpath = this._resolveFilename(file);
	co(function * () {
		var { res } = yield this._ossForFile(file).delete(fullpath);
		if (res.statusCode !== 200 && res.statusCode !== 204) {
			return callback(Error('Aliyun returned status code ' + res.statusCode));
		}
		callback();
	}).catch(err => callback(err));
};

// Check if a file with the specified filename already exists. Callback called
// with the file headers if the file exists, null otherwise.
AliOssAdapter.prototype.fileExists = function (filename, callback) {
	var fullpath = this._resolveFilename({ filename: filename });
	co(function * () {
		var { res } = yield this.client.head(fullpath);
		if (res.statusCode === 404) return callback(); // File does not exist
		callback(null, res.headers);
	}).catch(err => callback(err));
};

module.exports = AliOssAdapter;
