// Copyright 2015, EMC, Inc.

"use strict";

var di = require('di'),
    tftpd = require('tftp');

module.exports = TftpServerFactory;
di.annotate(TftpServerFactory, new di.Provide('Tftp.Server'));
di.annotate(TftpServerFactory, new di.Inject(
        'Logger',
        'Services.Configuration',
        'Protocol.Events',
        'Services.Lookup'
    )
);


function TftpServerFactory(Logger, configuration, eventsProtocol, lookupService) {
    var logger = Logger.initialize(TftpServerFactory);

    function Tftp() {
        this.host = configuration.get('tftpBindAddress', '0.0.0.0');
        this.port = configuration.get('tftpBindPort', 69);
        this.root = configuration.get('tftpRoot', './static/tftp');

        this._tftp = tftpd.createServer({
            host: this.host,
            port: this.port,
            root: this.root
        });
    }

    Tftp.prototype.logListening  = function() {
        logger.info("TFTP Server Listening %s:%s".format(Tftp.host, Tftp.port));
    };

    Tftp.prototype.handleError = function(err) {
      logger.critical("TFTP main socket error: ", err);
      setImmediate(function() {
          process.exit(-1); // exit the program entirely if we can't listen for TFTP requests
      });
    };

    Tftp.prototype.logClose = function() {
        logger.info("TFTP server closed.");
    };

    Tftp.prototype.handleRequest = function(req, res){
        req._startAt = process.hrtime();

        req.on("error", function() {
            logger.warning("Tftp error", {
                file: req.file,
                remoteAddress: req.stats.remoteAddress,
                remotePort: req.stats.remotePort,
                size: req.size
            });
        });

        res.on("finish", function() {
            if (!req._startAt) {
                return '';
            }

            var diff = process.hrtime(req._startAt);
            var ms = diff[0] * 1e3 + diff[1] * 1e-6;

            logger.debug('tftp: ' + ms.toFixed(3) + ' ' + req.file, {
                ip: req.stats.remoteAddress
            });

            lookupService.ipAddressToNodeId(req.stats.remoteAddress)
            .then(function(nodeId) {
                nodeId = nodeId || 'external';
                eventsProtocol.publishTftpSuccess(nodeId, {
                    file: req.file,
                    remoteAddress: req.stats.remoteAddress,
                    remotePort: req.stats.remotePort,
                    size: res._writer._size,
                    time: ms.toFixed(3)
                });
            })
            .catch(function(error) {
                logger.error("Error publishing TFTP success message: ", {
                    error: error
                });
            });
        });

        req.on("abort", function() {
            logger.warning("Tftp abort", {
                file: req.file,
                remoteAddress: req.stats.remoteAddress,
                remotePort: req.stats.remotePort,
                size: req.size
            });
        });
    };

    Tftp.prototype.listen = function() {

        this._tftp.on("listening", this.logListening);

        this._tftp.on("error", this.handleError);

        this._tftp.on("request", this.handleRequest);

        this._tftp.on("close", this.logClose);

        this._tftp.listen();
    };

    Tftp.prototype.start = function() {
        this.listen();
    };

    Tftp.prototype.stop = function(){
        this._tftp.close();
    };

    Tftp.create = function() {
        return new Tftp();
    };

    return Tftp;
}
