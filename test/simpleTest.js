
var pdfGen = require('../lib/index');
//var sample1 = require('./sample1.json');
var fs = require('fs');

// Very simple markup implemenation - only allows . notation access.
// You can use various template/markup libs - I use markup-js currently

function index(obj,i) {return obj[i]};

var REG = /\{([^\}]+)\}/g;

function resolvePath(path, data){
	return path.split('.').reduce(index, data);
}

function markup(template, data){

	var m = template.replace(REG, function (m, p1) {			
			return resolvePath(p1, data);
    });
	return m;
}

function createOutput(scenarioName, data, callback) {

	var outfile = './output/' + scenarioName + '.pdf';
	var config = require('./config/' + scenarioName + '.json');

	pdfGen(config, {markup : markup}).generate(outfile, data, callback);	
}

function createOutputWithStreams(scenarioName, data, callback) {

	var outStream = fs.createWriteStream('./output/' + scenarioName + 'WithStreams.pdf');
	var config = require('./config/' + scenarioName + '.json');

	if(callback) {
		outStream.on('finish', callback);
	}
	pdfGen(config, {markup : markup}).generate(outStream, data, callback);	
	outStream.end();
}

createOutput('sample1', { testField : "dynamic value"});
createOutput('modified1'); 


createOutputWithStreams('sample1', { testField : "dynamic value"}, function() { 
	// uses Sample1 as template to add further items.
	createOutputWithStreams('modified1'); 
}); 













