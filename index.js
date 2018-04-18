/*
TODO
- Check whether files exist before uploading (will always overwrite as-is)
- Support multiple retry attempts if a file exists (see FS Adapter)
*/

// Mirroring keystone 0.4's support of node 0.12.
var assign = require("object-assign");
var debug = require("debug")("keystone-oss");
var ensureCallback = require("keystone-storage-namefunctions/ensureCallback");
var knox = require("knox");
var nameFunctions = require("keystone-storage-namefunctions");
var pathlib = require("path");

var DEFAULT_OPTIONS = {
	endpoint: process.env.OSS_ENDPOINT,
	key: process.env.OSS_KEY,
	secret: process.env.OSS_SECRET,
	bucket: process.env.OSS_BUCKET,
	generateFilename: nameFunctions.randomFilename,
};

// This constructor is usually called indirectly by the Storage class
// in keystone.

// OSS-specific options should be specified in an `options.oss` field,
// which can contain the following options: { key, secret, bucket, region,
// headers, path }.

// The schema can contain the additional fields { path, bucket, etag }.

// See README.md for details and usage examples.

function OSSAdapter (options, schema) {
	this.options = assign({}, DEFAULT_OPTIONS, options.oss);

	// Support `defaultHeaders` option alias for `headers`
	// TODO: Remove me with the next major version bump
	if (this.options.defaultHeaders) {
		this.options.headers = this.options.defaultHeaders;
	}

	// Knox will check for the 'key', 'secret' and 'bucket' options.
	this.client = knox.createClient(this.options);

	// If path is specified it must be absolute.
	if (options.path != null && !pathlib.isAbsolute(options.path)) {
		throw Error("Configuration error: OSS path must be absolute");
	}

	// Ensure the generateFilename option takes a callback
	this.options.generateFilename = ensureCallback(this.options.generateFilename);
}

OSSAdapter.compatibilityLevel = 1;

// All the extra schema fields supported by this adapter.
OSSAdapter.SCHEMA_TYPES = {
	filename: String,
	bucket: String,
	path: String,
	etag: String,
};

OSSAdapter.SCHEMA_FIELD_DEFAULTS = {
	filename: true,
	bucket: false,
	path: false,
	etag: false,
};

// Return a knox client configured to interact with the specified file.
OSSAdapter.prototype._knoxForFile = function (file) {
	// Clients are allowed to store the bucket name in the file structure. If they
	// do it'll make it possible to have some files in one bucket and some files
	// in another bucket. The knox client is configured per-bucket, so if you're
	// using multiple buckets we'll need a different knox client for each file.
	if (file.bucket && file.bucket !== this.options.bucket) {
		var ossoptions = assign({}, this.options, { bucket: file.bucket });
		return knox.createClient(ossoptions);
	} else {
		return this.client;
	}
};

// Get the full, absolute path name for the specified file.
OSSAdapter.prototype._resolveFilename = function (file) {
	// Just like the bucket, the schema can store the path for files. If the path
	// isn't stored we'll assume all the files are in the path specified in the
	// oss.path option. If that doesn't exist we'll assume the file is in the root
	// of the bucket. (Whew!)
	var path = this.options.path || "/";
	return pathlib.join(path, file.filename);
};

OSSAdapter.prototype.uploadFile = function (file, callback) {
	var self = this;
	this.options.generateFilename(file, 0, function (err, filename) {
		if (err) return callback(err);

		// The expanded path of the file on the filesystem.
		var localpath = file.path;

		// The destination path inside the OSS bucket.
		file.path = self.options.path;
		file.filename = filename;
		var destpath = self._resolveFilename(file);

		// Figure out headers
		var headers = assign({}, self.options.headers, {
			"Content-Length": file.size,
			"Content-Type": file.mimetype,
		});

		debug("Uploading file %s", filename);
		self.client.putFile(localpath, destpath, headers, function (err, res) {
			if (err) return callback(err);
			if (res.statusCode !== 200) {
				return callback(
					new Error("oss returned status code: " + res.statusCode)
				);
			}
			res.resume(); // Discard (empty) body.

			// We'll annotate the file with a bunch of extra properties. These won't
			// be saved in the database unless the corresponding schema options are
			// set.
			file.filename = filename;
			file.etag = res.headers.etag; // TODO: This etag is double-quoted (??why?)

			// file.url is automatically populated by keystone's Storage class so we
			// don't need to set it here.

			// The path and bucket can be stored on a per-file basis if you want.
			// The effect of this is that you can have some (eg, old) files in your
			// collection stored in different bucket / different path inside your
			// bucket. This means you can do slow data migrations. Note that if you
			// *don't* store these values you can arguably migrate your data more
			// easily - just move it all, reconfigure and restart your server.
			file.path = self.options.path;
			file.bucket = self.options.bucket;

			debug("file upload successful");
			callback(null, file);
		});
	});
};

// Note that this will provide a public URL for the file, but it will only
// work if:
// - the bucket is public (best) or
// - the file is set to a canned ACL (ie, headers:{ 'x-amz-acl': 'public-read' } )
// - you pass credentials during your request for the file content itself
OSSAdapter.prototype.getFileURL = function (file) {
	// Consider providing an option to use insecure http. I can't think of any
	// sensible use case for plain http though. https should be used everywhere.
	return this._knoxForFile(file).https(this._resolveFilename(file));
};

OSSAdapter.prototype.removeFile = function (file, callback) {
	var fullpath = this._resolveFilename(file);
	this._knoxForFile(file).deleteFile(fullpath, function (err, res) {
		if (err) return callback(err);
		// Deletes return 204 according to the spec, but we'll allow 200 too:
		// http://docs.aws.amazon.com/AmazonOSS/latest/API/RESTObjectDELETE.html
		if (res.statusCode !== 200 && res.statusCode !== 204) {
			return callback(Error("oss returned status code " + res.statusCode));
		}
		res.resume(); // Discard the body
		callback();
	});
};

// Check if a file with the specified filename already exists. Callback called
// with the file headers if the file exists, null otherwise.
OSSAdapter.prototype.fileExists = function (filename, callback) {
	var fullpath = this._resolveFilename({ filename: filename });
	this.client.headFile(fullpath, function (err, res) {
		if (err) return callback(err);

		if (res.statusCode === 404) return callback(); // File does not exist
		callback(null, res.headers);
	});
};

module.exports = OSSAdapter;
