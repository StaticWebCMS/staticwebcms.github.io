(function (jStorage, undefined) {
    function githubRequest(method, address, token, data, callback) {
        var xmlhttp;
        if (window.XMLHttpRequest) {// code for IE7+, Firefox, Chrome, Opera, Safari
            xmlhttp = new XMLHttpRequest();
        }
        else {// code for IE6, IE5
            xmlhttp = new ActiveXObject("Microsoft.XMLHTTP");
        }

        xmlhttp.dataType = "json";

        xmlhttp.open(method, address, true);

        xmlhttp.onreadystatechange = function () {
            if (this.readyState == 4) {
                if (this.status >= 200 && this.status < 300 || this.status === 304) {
                    var responseData = this.responseText ? JSON.parse(this.responseText) : {};
                    responseData['last-modified'] = this.getResponseHeader("Last-Modified");
                    callback(null, responseData, this);
                } else {
                    // This is a special for get directory calls...
                    if (this.status == 0 && address.indexOf('/contents/') > 0) {
                        callback(null, [], this);
                    }

                    callback({
                        path: address,
                        request: this,
                        error: this.status,
                    });
                }
            }
        };

        xmlhttp.setRequestHeader('Accept', 'application/json;charset=UTF-8');
        xmlhttp.setRequestHeader('Content-Type', 'application/json;charset=UTF-8');
        if (token) {
            xmlhttp.setRequestHeader('Authorization', 'token ' + token);
        }

        data ? xmlhttp.send(JSON.stringify(data)) : xmlhttp.send();
    }

    jStorage.providers.github = {
        init: function (wrapper, config) {
            var self = this;

            this._config = config;
            this._hasCallback = config && typeof (config.callback) === "function";
            this._state = 'random' + new Date().getTime();
            this._code = false;
            this._shaCache = {};

            this.ensureAuth(wrapper, config);

            // https://github.com/settings/tokens/new
            var token = this._config.token;

            this._hasRepo = config && typeof (config.repo) === "string";
            this._hasToken = config && typeof (config.token) === "string";

            var callStatus = false;
            if (this._hasRepo && this._hasToken) {
                callStatus = {
                    'isOK': true,
                    'code': 0,
                    'msg': ''
                };
            } else {
                var msg = '';
                if (!this._hasToken) {
                    msg += 'No user token specified. ';
                }
                if (!this._hasRepo) {
                    msg += 'No repository specified. ';
                }
                callStatus = {
                    'isOK': false,
                    'code': -1,
                    'msg': msg
                };
            }

            if (self._hasCallback) {
                try {
                    self._config.callback(wrapper, callStatus);
                } catch (e) {
                    // TODO: handle error
                }
            }
        },
        listStorages: function (callback) {
            var self = this;

            addr = "https://api.github.com/user/repos";
            githubRequest("GET", addr, self._config.token, false, function () {
                if (arguments.length >= 2) {
                    var repos = arguments[1];

                    var storages = [];
                    for (var i = 0; i < repos.length; i++) {
                        var currentRepo = repos[i];
                        storages.push({
                            'name': currentRepo['name'],
                            'path': currentRepo['full_name'],
                            'permissions': {
                                'admin': currentRepo.permissions.admin,
                                'write': currentRepo.permissions.push,
                                'read': true /* As we could get it, we have access (atleast it is the case in GitHub) */
                            }
                        })
                    }

                    callback(storages);
                }
                else {
                    callback([]);
                }
            });
        },
        get: function (name, callback, extendedOptions) {
            var self = this;

            var repo = this.getRepo(this._config.repo, extendedOptions);

            // Remove begining slash
            if (name && name.indexOf('/') == 0) {
                name = name.substring(1);
            }

            // Remove ending slash
            if (name && name[name.length - 1] == '/') {
                name = name.substring(0, name.length - 1);
            }

            addr = "https://api.github.com/repos/" + repo + "/contents/" + name;
            githubRequest("GET", addr, self._config.token, false, function () {
                if (arguments.length >= 2) {
                    var info = arguments[1];
                    if ('length' in info) {
                        for (var i = 0; i < info.length; i++) {
                            self._shaCache[info[i].path] = info[i].sha;
                        }
                        callback(null, { 'isOK': false, 'msg': 'this is a directory', 'code': -2 });
                    }
                    else if (info.type == "file") {
                        var data = arguments[1].content;

                        if (data && data.indexOf('\n') !== -1) {
                            // Fixing data format returned by github as atob doesn't know what todo with newlines.
                            data = data.replace(/\n/g, '');
                        }

                        self._shaCache[name] = info.sha;
                        callback(
                            {
                                'name': info.path,
                                'size': info.size,
                                'mime-type': 'text/html',
                                'modified': info['last-modified'],
                                'data': atob(data)
                            },
                            { 'isOK': true, 'msg': '', 'code': 0 });
                    } else {
                        callback(null, { 'isOK': false, 'msg': 'This is not a valid file', 'code': -1 });
                    }
                } else {
                    callback(null, { 'isOK': false, 'msg': arguments[0].request.statusText, 'code': arguments[0].request.status });
                }
            });
        },
        set: function (name, content, callback) {
            var self = this;

            // Remove begining slash
            if (name && name.indexOf('/') == 0) {
                name = name.substring(1);
            }

            // Remove ending slash
            if (name && name[name.length - 1] == '/') {
                name = name.substring(0, name.length - 1);
            }

            // update content of file
            addr = "https://api.github.com/repos/" + self._config.repo + "/contents/" + name;
            var data = {
                "message": "jStorage add/update",
                "content": btoa(content)
            };
            // This is required to update existing file (we need to tell github from what version we are trying to update)
            var sha = self._shaCache[name];
            if (sha) {
                data["sha"] = sha;
            }

            githubRequest("PUT", addr, self._config.token, data, function () {
                if (arguments.length >= 2) {
                    var info = arguments[1];
                    if (info.content && info.content.type == "file") {
                        callback(
                            {
                                'name': info.content.path,
                                'size': info.content.size,
                                'mime-type': 'text/html',
                                'modified': info['last-modified'],
                            },
                            { 'isOK': true, 'msg': '', 'code': 0 });
                    } else {
                        callback(null, { 'isOK': false, 'msg': 'This is not a valid file', 'code': -1 });
                    }
                } else {
                    callback(null, { 'isOK': false, 'msg': arguments[0].request.statusText, 'code': arguments[0].request.status });
                }
            });
        },
        move: function (currentName, newName, callback) {
            var self = this;

            //// Remove begining slash
            //if (name && name.indexOf('/') == 0) {
            //    name = name.substring(1);
            //}

            //// Remove ending slash
            //if (name && name[name.length - 1] == '/') {
            //    name = name.substring(0, name.length - 1);
            //}
            //console.log('github move');
        },
        del: function (name, callback) {
            var self = this;

            // Remove begining slash
            if (name && name.indexOf('/') == 0) {
                name = name.substring(1);
            }

            // Remove ending slash
            if (name && name[name.length - 1] == '/') {
                name = name.substring(0, name.length - 1);
            }

            // update content of file
            addr = "https://api.github.com/repos/" + self._config.repo + "/contents/" + name;
            // sha is required to remove file, so we need to have called get before we can delete a file right now.
            var sha = self._shaCache[name];
            // If we don't already have sha, get it.
            if (!sha) {
                // find parent directory name
                var parentName = name;
                var index = parentName.lastIndexOf('/');
                if (index != -1) {
                    // We are looking a subdirectory
                    parentName = parentName.substring(0, index);
                } else {
                    // We are looking in root..
                    parentName = '';
                }

                var test = function (info, status) {
                    if (status.code == -2) {
                        // sha has been set, call ourself...
                        self.del(name, callback);
                    } else {
                        callback({ 'isOK': false, 'msg': 'no file or folder matching name', 'code': 404 });
                    }
                };
                self.get(parentName, test);
                return;
            }


            var data = {
                "message": "jStorage delete",
                "sha": sha
            };

            githubRequest("DELETE", addr, self._config.token, data, function () {
                if (arguments.length >= 2) {
                    var data = arguments[1].content;
                    callback({ 'isOK': true, 'msg': '', 'code': 0 });
                } else {
                    callback({ 'isOK': false, 'msg': arguments[0].request.statusText, 'code': arguments[0].request.status });
                }
            });
        },
        list: function (name, callback) {
            // Remove begining slash
            if (name && name.indexOf('/') == 0) {
                name = name.substring(1);
            }

            // Remove ending slash
            if (name && name[name.length - 1] == '/') {
                name = name.substring(0, name.length - 1);
            }

            var self = this;
            addr = "https://api.github.com/repos/" + this._config.repo + "/contents/" + name;
            githubRequest("GET", addr, self._config.token, false, function () {
                console.log('listA', arguments);
                if (arguments.length >= 2) {
                    var info = arguments[1];
                    console.log('list', info);
                    if (info.type != "file") {

                        var list = [];
                        for (var i = 0; i < info.length; i++) {
                            list.push({
                                'name': info[i].name,
                                'path': '/' + info[i].path,
                                'size': info[i].size,
                                'mime-type': 'text/html',
                                'modified': info['last-modified']
                            });
                            self._shaCache[info[i].path] = info[i].sha;
                        }

                        console.log('list content:', list);

                        if (list.length != 0) {
                            callback(list, { 'isOK': true, 'msg': '', 'code': 0 });
                        } else {
                            callback(list, { 'isOK': false, 'msg': 'nothing to list', 'code': 404 });
                        }
                    } else {
                        callback([], { 'isOK': false, 'msg': 'This is not a valid file', 'code': -1 });
                    }
                } else {
                    callback([], { 'isOK': false, 'msg': arguments[0].request.statusText, 'code': arguments[0].request.status });
                }
            });
        },
        exists: function (name, callback) {
            //console.log('github exists');
        },
        getTokenFromQuery: function () {
            // remove questionmark from querystring
            var search = window.location.search.substr(1);
            var arr = search.split('&');
            if (arr.length > 0) {
                var tmpToken = '',
                    tmpState = '';
                for (var i = 0; i < arr.length; i++) {
                    var pair = arr[i].split('=');
                    if (pair.length !== 2) {
                        continue;
                    }

                    var key = pair[0];
                    var val = pair[1];

                    switch (key) {
                        case 'token':
                            tmpToken = val;
                            break;
                        case 'state':
                            tmpState = val;
                            break;
                    }
                }

                // Do we have token and tokenstate?
                if (tmpToken && tmpState) {
                    var state = localStorage.getItem('jStorage.github.tokenState');
                    if (state === tmpState) {
                        // Token state are valid, set/change token.
                        return tmpToken;
                    }
                }
            }
            return false;
        },
        ensureAuth: function (wrapper, config) {
            // we require token today, allow for oauth fetching of token here

            // Because of security reasons, if we have valid token in url, force remove...
            var token = this.getTokenFromQuery();
            if (!!token) {
                // store token for later use
                window.localStorage.setItem('token', token);

                // Make sure we don't have token in url (as if user copies the url and sends it to friend/or someone else they will be logged in as our user)
                var search = '&' + window.location.search.substr(1); // replace question mark with '&' char
                search = search.replace("&token=" + token, '');
                search = search.replace("&state=" + localStorage.getItem('jStorage.github.tokenState'), '');

                // make sure we remove the temporary tokenState from storage
                window.localStorage.removeItem('jStorage.github.tokenState');
                if (search.length === 0) {
                    // we have removed everything in querystring, reset href without querystring part, we are doing it this way instead of setting 'search' property because setting 'search' property will result in '?' in the end of url.
                    window.location.href = location.href.replace(location.search, '');
                } else {
                    window.location.search = '?' + search.substr(1); // removes first '&' char
                }
            }

            // If we have a token provided in config we will use that and can there for ignore the rest of below..
            if (!!this._config.token) {
                return;
            }

            var token = window.localStorage.getItem('token');
            if (!!token) {
                this._config.token = token;
                return;
            }

            var tokenService = this._config.tokenService;
            if (!!tokenService) {
                var startChar = '?';
                if (tokenService.indexOf('?')) {
                    startChar = '&';
                }
                var tokenState = 'ts' + new Date().getTime();
                localStorage.setItem('jStorage.github.tokenState', tokenState);
                // append a unique token state that we can later verify against.
                tokenService = tokenService + startChar + 'state=' + tokenState;
                window.location.assign(tokenService);
            } else {
                // TODO: no token service specified, what todo?
            }
        },
        getRepo: function(repo, extendedOptions) {
            var repo = this._config.repo;
            var hasExtendedOptions = !!extendedOptions;
            if (hasExtendedOptions) {
                var tmpRepo = extendedOptions['repo'];
                if (!!tmpRepo)  {
                    repo = tmpRepo;
                }
            }
            return repo;
        }
    };
})(jStorage);